const express = require('express');
const { query, withTransaction } = require('../config/database');
const { referralValidationLimiter } = require('../middleware/rateLimiter');
const { hashIp, validateReferralCodeFormat } = require('../utils/referralCode');
const { calculateEffortScore } = require('../utils/effortScore');
const { referralAnalyticsEnabled, rewardsEnabled } = require('../config/environment');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { isPublicReferralEventType, recordVerifiedInviteAcceptance } = require('../services/rewards');

const router = express.Router();
const botPattern = /(bot|crawl|spider|headless|curl|wget|python|axios)/i;

function retentionDays() {
  const value = Number(process.env.REFERRAL_RETENTION_DAYS || 365);
  return Number.isSafeInteger(value) && value > 0 ? value : 365;
}

function requireAnalytics(_req, res, next) {
  if (!referralAnalyticsEnabled()) {
    return res.status(503).json({ error: 'Referral analytics are not available.' });
  }
  return next();
}

function requireRewards(_req, res, next) {
  if (!rewardsEnabled()) {
    return res.status(503).json({ error: 'Crumb Saver rewards are not available.' });
  }
  return next();
}

function parseMetadata(value) {
  return value && typeof value === 'object' ? value : {};
}

router.post('/validate', requireAnalytics, referralValidationLimiter, async (req, res, next) => {
  try {
    const { code, sponsorId, customerEmail } = req.body;
    const userAgent = req.get('user-agent') || '';
    const ipHash = hashIp(req.ip);

    if (!code || !validateReferralCodeFormat(code)) {
      await query(
        `INSERT INTO code_validations (code_id, attempt_ip_hash, validation_result, reason, action_taken, retention_expires_at)
         VALUES (NULL, $1, 'fail', 'Invalid code format or checksum.', 'Rejected request', NOW() + ($2 * INTERVAL '1 day'))`,
        [ipHash, retentionDays()]
      );
      return res.status(400).json({ valid: false, reason: 'Invalid referral code format.' });
    }

    const codeResult = await query(
      `SELECT rc.*, s.id AS sponsor_id, s.referral_code AS sponsor_referral_code, s.safety_status
       FROM referral_codes rc
       JOIN sponsors s ON s.id = rc.sponsor_id
       WHERE rc.code_string = $1
         AND s.rewards_consent = true
         AND s.rewards_consent_at IS NOT NULL
         AND s.rewards_consent_withdrawn_at IS NULL`,
      [code]
    );

    if (!codeResult.rowCount) {
      return res.status(404).json({ valid: false, reason: 'Referral code not found.' });
    }

    const referralCode = codeResult.rows[0];
    const reasons = [];
    let result = 'pass';

    if (referralCode.status !== 'active' || referralCode.safety_status === 'blocked') {
      reasons.push('Referral code is not active.');
      result = 'fail';
    }

    if (sponsorId && sponsorId === referralCode.sponsor_id) {
      reasons.push('Sponsors cannot redeem their own referral codes.');
      result = 'fail';
    }

    if (botPattern.test(userAgent)) {
      reasons.push('Suspicious user agent detected.');
      result = 'flagged';
    }

    const dailyLimitResult = await query(
      `SELECT COUNT(*)::int AS attempts
       FROM code_validations
       WHERE code_id = $1
         AND validation_result = 'pass'
         AND attempt_timestamp >= NOW() - INTERVAL '1 day'`,
      [referralCode.id]
    );

    if (dailyLimitResult.rows[0].attempts >= 100) {
      reasons.push('Daily redemption limit reached for this code.');
      result = 'fail';
    }

    const ipReuseResult = await query(
      `SELECT COUNT(*)::int AS attempts
       FROM code_validations
       WHERE attempt_ip_hash = $1
         AND validation_result = 'pass'
         AND attempt_timestamp >= NOW() - INTERVAL '1 hour'`,
      [ipHash]
    );

    if (ipReuseResult.rows[0].attempts >= 1) {
      reasons.push('This IP has already redeemed a code in the last hour.');
      result = 'fail';
    }

    if (customerEmail) {
      const dualInviteResult = await query(
        `SELECT referral_code_used
         FROM orders
         WHERE LOWER(customer_email) = LOWER($1)
           AND referral_code_used IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [customerEmail]
      );

      if (dualInviteResult.rowCount && dualInviteResult.rows[0].referral_code_used !== code) {
        reasons.push('Customer already redeemed a different sponsor code.');
        result = 'flagged';
      }
    }

    if (sponsorId) {
      const loopResult = await query(
        `SELECT 1
         FROM orders
         WHERE sponsor_id = $1
           AND referral_code_used = $2
         LIMIT 1`,
        [referralCode.sponsor_id, code]
      );

      if (loopResult.rowCount) {
        reasons.push('Referral loop detected between sponsors.');
        result = 'flagged';
      }
    }

    const recentFailures = await query(
      `SELECT COUNT(*)::int AS attempts
       FROM code_validations
       WHERE code_id = $1
         AND attempt_ip_hash = $2
         AND validation_result IN ('fail', 'flagged')
         AND attempt_timestamp >= NOW() - INTERVAL '24 hours'`,
      [referralCode.id, ipHash]
    );

    if (recentFailures.rows[0].attempts >= 3 && result === 'pass') {
      reasons.push('Repeated suspicious attempts detected from this IP.');
      result = 'flagged';
    }

    await query(
      `INSERT INTO code_validations (code_id, attempt_ip_hash, validation_result, reason, action_taken, retention_expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 * INTERVAL '1 day'))`,
      [
        referralCode.id,
        ipHash,
        result,
        reasons.join(' ') || 'Validation passed.',
        result === 'pass' ? 'Allow redemption' : 'Hold for review',
        retentionDays(),
      ]
    );

    if (result === 'pass') {
      return res.json({ valid: true, codeId: referralCode.id, sponsorId: referralCode.sponsor_id });
    }

    return res.status(result === 'flagged' ? 403 : 400).json({ valid: false, reason: reasons.join(' '), flagged: result === 'flagged' });
  } catch (error) {
    return next(error);
  }
});

router.post('/event', requireAnalytics, async (req, res, next) => {
  try {
    const { code, eventType, referrer, metadata } = req.body;
    const userAgent = req.get('user-agent') || '';
    const ipHash = hashIp(req.ip);

    if (!code || !isPublicReferralEventType(eventType)) {
      return res.status(400).json({ error: 'Only click, share, and flagged referral events are accepted publicly.' });
    }

    const codeResult = await query(
      `SELECT rc.*
       FROM referral_codes rc
       JOIN sponsors s ON s.id = rc.sponsor_id
       WHERE rc.code_string = $1
         AND rc.status = 'active'
         AND s.rewards_consent = true
         AND s.rewards_consent_at IS NOT NULL
         AND s.rewards_consent_withdrawn_at IS NULL`,
      [code]
    );
    if (!codeResult.rowCount) {
      return res.status(404).json({ error: 'Referral code not found.' });
    }

    const referralCode = codeResult.rows[0];
    let fraudScore = 0;
    if (botPattern.test(userAgent)) fraudScore += 50;
    await query(
      `INSERT INTO referral_events (code_id, event_type, user_ip_hash, referrer, order_id, metadata, fraud_score, retention_expires_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, NOW() + ($7 * INTERVAL '1 day'))`,
      [referralCode.id, eventType, ipHash, referrer || null, JSON.stringify(parseMetadata(metadata)), fraudScore, retentionDays()]
    );

    const uniqueClickerResult = await query(
      `SELECT COUNT(DISTINCT user_ip_hash)::int AS count
       FROM referral_events
       WHERE code_id = $1
         AND event_type = 'click'`,
      [referralCode.id]
    );

    await query(
      `UPDATE referral_codes
       SET unique_clickers = $2,
           safety_flags = CASE WHEN $3 > 0 THEN safety_flags || jsonb_build_array('suspicious-activity') ELSE safety_flags END,
           updated_at = NOW()
       WHERE id = $1`,
      [referralCode.id, uniqueClickerResult.rows[0].count, fraudScore]
    );

    return res.status(201).json({
      message: 'Referral event recorded.',
      fraudScore,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/acceptance', requireRewards, authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const result = await withTransaction((client) => recordVerifiedInviteAcceptance(client, {
      code: req.body.code,
      recipientReference: req.body.recipientReference,
    }));
    if (!result) {
      return res.status(404).json({ error: 'Eligible consented referral code not found.' });
    }
    return res.status(result.duplicate ? 200 : 201).json({
      accepted: true,
      duplicate: result.duplicate,
      sponsorId: result.sponsorId,
    });
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.get('/:code/stats', requireRewards, authenticateToken, async (req, res, next) => {
  try {
    const code = req.params.code;
    const codeResult = await query(
      `SELECT rc.*, s.name AS sponsor_name, s.tier, s.discount_earned
       FROM referral_codes rc
       JOIN sponsors s ON s.id = rc.sponsor_id
       WHERE rc.code_string = $1`,
      [code]
    );

    if (!codeResult.rowCount) {
      return res.status(404).json({ error: 'Referral code not found.' });
    }
    if (!req.user.isOperator && req.user.sponsorId !== codeResult.rows[0].sponsor_id) {
      return res.status(403).json({ error: 'You do not have access to these referral statistics.' });
    }

    const statsResult = await query(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END), 0) AS clicks,
         COALESCE(SUM(CASE WHEN event_type = 'share' THEN 1 ELSE 0 END), 0) AS shares,
         COALESCE(SUM(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END), 0) AS conversions,
         COALESCE(AVG(fraud_score), 0) AS average_fraud_score
       FROM referral_events
       WHERE code_id = $1`,
      [codeResult.rows[0].id]
    );

    const effort = calculateEffortScore({
      ...statsResult.rows[0],
      usageCount: codeResult.rows[0].usage_count,
    });

    return res.json({
      code: codeResult.rows[0].code_string,
      sponsor: codeResult.rows[0].sponsor_name,
      tier: codeResult.rows[0].tier,
      usageCount: codeResult.rows[0].usage_count,
      uniqueClickers: codeResult.rows[0].unique_clickers,
      conversionCount: codeResult.rows[0].conversion_count,
      safetyFlags: codeResult.rows[0].safety_flags,
      analytics: {
        clicks: Number(statsResult.rows[0].clicks),
        shares: Number(statsResult.rows[0].shares),
        conversions: Number(statsResult.rows[0].conversions),
        averageFraudScore: Number(statsResult.rows[0].average_fraud_score),
        effortScore: effort.effortScore,
        discountEarned: codeResult.rows[0].discount_earned,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

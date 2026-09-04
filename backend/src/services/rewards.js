const { calculateEffortScore, applyTierDiscountCap } = require('../utils/effortScore');
const {
  approvedRewardsPrivacyNoticeVersion,
  rewardsEnabled,
} = require('../config/environment');
const crypto = require('crypto');

const ACCEPTANCE_POINTS = 1;
const PAID_PURCHASE_POINTS = 5;
const PUBLIC_REFERRAL_EVENT_TYPES = new Set(['click', 'share', 'flagged']);

function retentionDays() {
  const value = Number(process.env.REFERRAL_RETENTION_DAYS || 365);
  return Number.isSafeInteger(value) && value > 0 ? value : 365;
}

function isPublicReferralEventType(eventType) {
  return PUBLIC_REFERRAL_EVENT_TYPES.has(eventType);
}

function hashRewardIdentity(provider, subject) {
  const salt = process.env.REWARD_REFERENCE_SALT;
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  let normalizedSubject = String(subject || '').trim();
  if (normalizedProvider === 'shopify') {
    const shopifySubject = normalizedSubject.match(/^(?:gid:\/\/shopify\/Customer\/)?(\d+)$/i);
    if (!shopifySubject) {
      throw new Error('The verified Shopify identity must be a Shopify customer ID.');
    }
    normalizedSubject = BigInt(shopifySubject[1]).toString();
  }
  if (!salt || !normalizedProvider || !normalizedSubject) {
    throw new Error('A verified identity provider, subject, and REWARD_REFERENCE_SALT are required.');
  }
  return crypto
    .createHmac('sha256', salt)
    .update(`${normalizedProvider}:${normalizedSubject}`)
    .digest('hex');
}

async function lockShopifyOrder(client, orderId) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`shopify-order:${String(orderId)}`]
  );
}

async function updateSponsorPerformance(client, sponsorId) {
  const metricsResult = await client.query(
    `SELECT COALESCE(MAX(rc.usage_count), 0) AS usage_count,
            COALESCE(SUM(CASE WHEN re.event_type = 'click' THEN 1 ELSE 0 END), 0) AS clicks,
            COALESCE(SUM(CASE WHEN re.event_type = 'share' THEN 1 ELSE 0 END), 0) AS shares,
            COALESCE(SUM(CASE WHEN re.event_type = 'conversion' THEN 1 ELSE 0 END), 0) AS conversions,
            COALESCE((
              SELECT SUM(rl.points_delta)
              FROM reward_ledger rl
              WHERE rl.sponsor_id = s.id
            ), 0) AS verified_reward_points
     FROM sponsors s
     LEFT JOIN referral_codes rc ON rc.sponsor_id = s.id
     LEFT JOIN referral_events re ON re.code_id = rc.id
     WHERE s.id = $1
     GROUP BY s.id`,
    [sponsorId]
  );
  if (!metricsResult.rowCount) return null;

  const metrics = metricsResult.rows[0];
  const effort = calculateEffortScore({
    ...metrics,
    usageCount: metrics.usage_count,
    verifiedRewardPoints: metrics.verified_reward_points,
  });
  const tierState = applyTierDiscountCap(effort.discountEarned, metrics.verified_reward_points);
  await client.query(
    `UPDATE sponsors
     SET effort_score = $2,
         discount_earned = $3,
         tier = $4,
         customization_limit = $5,
         updated_at = NOW()
     WHERE id = $1`,
    [sponsorId, effort.effortScore, tierState.discountEarned, tierState.tier, tierState.customizationLimit]
  );
  return { ...effort, ...tierState };
}

async function recordVerifiedShopifyConversion(client, { code, orderId, purchaserIdentity }) {
  if (!rewardsEnabled()) return null;
  if (
    !code
    || !orderId
    || String(purchaserIdentity?.provider || '').toLowerCase() !== 'shopify'
    || !purchaserIdentity?.subject
  ) return null;
  await lockShopifyOrder(client, orderId);
  const pendingReversal = await client.query(
    'SELECT 1 FROM pending_shopify_reward_reversals WHERE shopify_order_id = $1',
    [String(orderId)]
  );
  if (pendingReversal.rowCount) return null;
  const existingLedger = await client.query(
    `SELECT sponsor_id
     FROM reward_ledger
     WHERE event_type = 'paid_purchase' AND source_reference = $1`,
    [String(orderId)]
  );
  if (existingLedger.rowCount) {
    return { sponsorId: existingLedger.rows[0].sponsor_id, duplicate: true };
  }
  const codeResult = await client.query(
    `SELECT rc.id, rc.sponsor_id, s.reward_identity_hash
     FROM referral_codes rc
     JOIN sponsors s ON s.id = rc.sponsor_id
     WHERE rc.code_string = $1
       AND rc.status = 'active'
       AND s.safety_status = 'active'
       AND s.rewards_consent = true
       AND s.rewards_consent_at IS NOT NULL
       AND s.rewards_consent_withdrawn_at IS NULL
       AND s.privacy_notice_version = $2
       AND s.reward_identity_hash IS NOT NULL`,
    [code, approvedRewardsPrivacyNoticeVersion()]
  );
  if (!codeResult.rowCount) return null;

  const referral = codeResult.rows[0];
  const purchaserIdentityHash = hashRewardIdentity(
    purchaserIdentity.provider,
    purchaserIdentity.subject
  );
  if (purchaserIdentityHash === referral.reward_identity_hash) {
    return { sponsorId: null, duplicate: false, rejected: 'self-referral' };
  }
  const inserted = await client.query(
    `INSERT INTO referral_events
       (code_id, event_type, order_id, metadata, fraud_score, retention_expires_at)
     VALUES ($1, 'conversion', $2, $3::jsonb, 0, NOW() + ($4 * INTERVAL '1 day'))
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [referral.id, String(orderId), JSON.stringify({ source: 'verified-shopify-paid-webhook' }), retentionDays()]
  );
  if (!inserted.rowCount) {
    const existing = await client.query(
      `SELECT sponsor_id
       FROM reward_ledger
       WHERE event_type = 'paid_purchase' AND source_reference = $1`,
      [String(orderId)]
    );
    return {
      sponsorId: existing.rows[0]?.sponsor_id || null,
      duplicate: true,
    };
  }

  const ledger = await client.query(
    `INSERT INTO reward_ledger
       (sponsor_id, referral_code_id, event_type, source_reference, points_delta, metadata, retention_expires_at)
     VALUES ($1, $2, 'paid_purchase', $3, $4, $5::jsonb, NOW() + ($6 * INTERVAL '1 day'))
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      referral.sponsor_id,
      referral.id,
      String(orderId),
      PAID_PURCHASE_POINTS,
      JSON.stringify({ source: 'verified-shopify-paid-webhook' }),
      retentionDays(),
    ]
  );
  if (!ledger.rowCount) {
    return { sponsorId: referral.sponsor_id, duplicate: true };
  }

  await client.query(
    `UPDATE referral_codes
     SET usage_count = usage_count + 1,
         conversion_count = conversion_count + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [referral.id]
  );
  const performance = await updateSponsorPerformance(client, referral.sponsor_id);
  return { sponsorId: referral.sponsor_id, duplicate: false, performance };
}

function hashRecipientReference(reference) {
  return hashRewardIdentity(reference.provider, reference.subject);
}

async function recordVerifiedInviteAcceptance(client, { code, recipientIdentity }) {
  if (!rewardsEnabled()) return null;
  if (
    !code
    || String(recipientIdentity?.provider || '').toLowerCase() !== 'shopify'
    || !recipientIdentity?.subject
  ) {
    throw new Error('Referral code and a server-verified Shopify recipient identity are required.');
  }
  const codeResult = await client.query(
    `SELECT rc.id, rc.sponsor_id, s.reward_identity_hash
     FROM referral_codes rc
     JOIN sponsors s ON s.id = rc.sponsor_id
     WHERE rc.code_string = $1
       AND rc.status = 'active'
       AND s.safety_status = 'active'
       AND s.rewards_consent = true
       AND s.rewards_consent_at IS NOT NULL
       AND s.rewards_consent_withdrawn_at IS NULL
       AND s.privacy_notice_version = $2
       AND s.reward_identity_hash IS NOT NULL`,
    [code, approvedRewardsPrivacyNoticeVersion()]
  );
  if (!codeResult.rowCount) return null;

  const referral = codeResult.rows[0];
  const sourceReference = hashRecipientReference(recipientIdentity);
  if (sourceReference === referral.reward_identity_hash) {
    return { sponsorId: null, duplicate: false, rejected: 'self-referral' };
  }
  const inserted = await client.query(
    `INSERT INTO reward_ledger
       (sponsor_id, referral_code_id, event_type, source_reference, points_delta, metadata, retention_expires_at)
     VALUES ($1, $2, 'verified_acceptance', $3, $4, $5::jsonb, NOW() + ($6 * INTERVAL '1 day'))
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      referral.sponsor_id,
      referral.id,
      sourceReference,
      ACCEPTANCE_POINTS,
      JSON.stringify({ source: 'trusted-account-acceptance' }),
      retentionDays(),
    ]
  );
  if (!inserted.rowCount) {
    const existing = await client.query(
      `SELECT sponsor_id
       FROM reward_ledger
       WHERE event_type = 'verified_acceptance' AND source_reference = $1`,
      [sourceReference]
    );
    return {
      sponsorId: existing.rows[0]?.sponsor_id || null,
      duplicate: true,
    };
  }
  const performance = await updateSponsorPerformance(client, referral.sponsor_id);
  return { sponsorId: referral.sponsor_id, duplicate: false, performance };
}

async function reverseVerifiedShopifyConversion(client, orderId) {
  await lockShopifyOrder(client, orderId);
  const original = await client.query(
    `SELECT id, sponsor_id, referral_code_id, points_delta
     FROM reward_ledger
     WHERE event_type = 'paid_purchase' AND source_reference = $1`,
    [String(orderId)]
  );
  if (!original.rowCount) {
    await client.query(
      `INSERT INTO pending_shopify_reward_reversals
         (shopify_order_id, retention_expires_at)
       VALUES ($1, NOW() + ($2 * INTERVAL '1 day'))
       ON CONFLICT (shopify_order_id) DO UPDATE
       SET received_at = NOW(),
           retention_expires_at = EXCLUDED.retention_expires_at`,
      [String(orderId), retentionDays()]
    );
    return null;
  }
  const entry = original.rows[0];
  const reversal = await client.query(
    `INSERT INTO reward_ledger
       (sponsor_id, referral_code_id, event_type, source_reference, points_delta, reverses_entry_id, metadata, retention_expires_at)
     VALUES ($1, $2, 'reversal', $3, $4, $5, $6::jsonb, NOW() + ($7 * INTERVAL '1 day'))
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      entry.sponsor_id,
      entry.referral_code_id,
      String(orderId),
      -Number(entry.points_delta),
      entry.id,
      JSON.stringify({ source: 'verified-shopify-reversal' }),
      retentionDays(),
    ]
  );
  if (!reversal.rowCount) {
    return { sponsorId: entry.sponsor_id, duplicate: true };
  }
  await client.query(
    `UPDATE referral_codes
     SET usage_count = GREATEST(usage_count - 1, 0),
         conversion_count = GREATEST(conversion_count - 1, 0),
         updated_at = NOW()
     WHERE id = $1`,
    [entry.referral_code_id]
  );
  const performance = await updateSponsorPerformance(client, entry.sponsor_id);
  return { sponsorId: entry.sponsor_id, duplicate: false, performance };
}

module.exports = {
  hashRewardIdentity,
  isPublicReferralEventType,
  recordVerifiedShopifyConversion,
  recordVerifiedInviteAcceptance,
  reverseVerifiedShopifyConversion,
  rewardsEnabled,
  updateSponsorPerformance,
};

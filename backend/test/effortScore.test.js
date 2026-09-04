const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateEffortScore, determineTier, applyTierDiscountCap } = require('../src/utils/effortScore');
const { isPublicReferralEventType } = require('../src/services/rewards');

test('unverified clicks and shares never create a financial reward', () => {
  const score = calculateEffortScore({
    clicks: 100,
    shares: 50,
    conversions: 0,
    usage_count: 0,
    verifiedRewardPoints: 0,
  });
  assert.equal(score.discountEarned, 0);
  assert.equal(score.effortScore, 100);
});

test('snake-case usage count applies the post-threshold score', () => {
  const score = calculateEffortScore({
    clicks: 100,
    shares: 50,
    usage_count: 4,
    verifiedRewardPoints: 20,
  });
  assert.equal(score.effortScore, 20);
  assert.equal(score.discountEarned, 0.2);
});

test('reward discounts respect verified activity thresholds, not money', () => {
  assert.deepEqual(determineTier(4), { tier: 'crumb', maxDiscount: 0.1, customizationLimit: 1 });
  assert.deepEqual(determineTier(5), { tier: 'maker', maxDiscount: 0.2, customizationLimit: 3 });
  assert.deepEqual(determineTier(20), { tier: 'community', maxDiscount: 0.3, customizationLimit: null });
  assert.equal(applyTierDiscountCap(0.3, 4).discountEarned, 0.1);
  assert.equal(applyTierDiscountCap(0.3, 5).discountEarned, 0.2);
});

test('public referral events cannot claim conversions', () => {
  assert.equal(isPublicReferralEventType('click'), true);
  assert.equal(isPublicReferralEventType('share'), true);
  assert.equal(isPublicReferralEventType('conversion'), false);
  assert.equal(isPublicReferralEventType('paid_purchase'), false);
});

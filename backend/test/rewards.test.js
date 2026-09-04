const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isPublicReferralEventType,
  recordVerifiedInviteAcceptance,
  recordVerifiedShopifyConversion,
  reverseVerifiedShopifyConversion,
} = require('../src/services/rewards');

function queuedClient(results) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      const result = results.shift();
      if (!result) throw new Error(`Unexpected query: ${text}`);
      return result;
    },
  };
}

test('public referral events exclude financial conversions', () => {
  assert.equal(isPublicReferralEventType('click'), true);
  assert.equal(isPublicReferralEventType('share'), true);
  assert.equal(isPublicReferralEventType('conversion'), false);
});

test('paid Shopify conversion writes an idempotent reward and refreshes performance', async () => {
  const originalFlag = process.env.CRUMB_SAVER_REWARDS_ENABLED;
  const originalNotice = process.env.REWARDS_PRIVACY_NOTICE_VERSION;
  process.env.CRUMB_SAVER_REWARDS_ENABLED = 'true';
  process.env.REWARDS_PRIVACY_NOTICE_VERSION = '2026-09';
  const client = queuedClient([
    { rowCount: 0, rows: [] },
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [{ id: 'code-id', sponsor_id: 'sponsor-id' }] },
    { rowCount: 1, rows: [{ id: 'event-id' }] },
    { rowCount: 1, rows: [{ id: 'ledger-id' }] },
    { rowCount: 1, rows: [] },
    {
      rowCount: 1,
      rows: [{
        usage_count: 1,
        clicks: 0,
        shares: 0,
        conversions: 1,
        verified_reward_points: 5,
      }],
    },
    { rowCount: 1, rows: [] },
  ]);
  try {
    const result = await recordVerifiedShopifyConversion(client, {
      code: 'WD-CODE',
      orderId: 'shopify-order-1',
    });
    assert.equal(result.duplicate, false);
    assert.equal(result.sponsorId, 'sponsor-id');
    assert.match(client.calls[4].text, /reward_ledger/);
    assert.equal(client.calls[4].params[3], 5);
  } finally {
    if (originalFlag === undefined) delete process.env.CRUMB_SAVER_REWARDS_ENABLED;
    else process.env.CRUMB_SAVER_REWARDS_ENABLED = originalFlag;
    if (originalNotice === undefined) delete process.env.REWARDS_PRIVACY_NOTICE_VERSION;
    else process.env.REWARDS_PRIVACY_NOTICE_VERSION = originalNotice;
  }
});

test('duplicate paid order keeps the original sponsor attribution', async () => {
  const originalFlag = process.env.CRUMB_SAVER_REWARDS_ENABLED;
  process.env.CRUMB_SAVER_REWARDS_ENABLED = 'true';
  const client = queuedClient([
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [{ sponsor_id: 'original-sponsor' }] },
  ]);
  try {
    const result = await recordVerifiedShopifyConversion(client, {
      code: 'CHANGED-CODE',
      orderId: 'shopify-order-1',
    });
    assert.deepEqual(result, { sponsorId: 'original-sponsor', duplicate: true });
  } finally {
    if (originalFlag === undefined) delete process.env.CRUMB_SAVER_REWARDS_ENABLED;
    else process.env.CRUMB_SAVER_REWARDS_ENABLED = originalFlag;
  }
});

test('trusted acceptance hashes its recipient reference before storage', async () => {
  const originalFlag = process.env.CRUMB_SAVER_REWARDS_ENABLED;
  const originalSalt = process.env.REWARD_REFERENCE_SALT;
  const originalNotice = process.env.REWARDS_PRIVACY_NOTICE_VERSION;
  process.env.CRUMB_SAVER_REWARDS_ENABLED = 'true';
  process.env.REWARD_REFERENCE_SALT = 'test-reward-reference-salt';
  process.env.REWARDS_PRIVACY_NOTICE_VERSION = '2026-09';
  const client = queuedClient([
    { rowCount: 1, rows: [{ id: 'code-id', sponsor_id: 'sponsor-id' }] },
    { rowCount: 1, rows: [{ id: 'ledger-id' }] },
    {
      rowCount: 1,
      rows: [{
        usage_count: 0,
        clicks: 0,
        shares: 0,
        conversions: 0,
        verified_reward_points: 1,
      }],
    },
    { rowCount: 1, rows: [] },
  ]);
  try {
    await recordVerifiedInviteAcceptance(client, {
      code: 'WD-CODE',
      recipientReference: 'recipient@example.test',
    });
    assert.notEqual(client.calls[1].params[2], 'recipient@example.test');
    assert.equal(client.calls[1].params[2].length, 64);
  } finally {
    if (originalFlag === undefined) delete process.env.CRUMB_SAVER_REWARDS_ENABLED;
    else process.env.CRUMB_SAVER_REWARDS_ENABLED = originalFlag;
    if (originalSalt === undefined) delete process.env.REWARD_REFERENCE_SALT;
    else process.env.REWARD_REFERENCE_SALT = originalSalt;
    if (originalNotice === undefined) delete process.env.REWARDS_PRIVACY_NOTICE_VERSION;
    else process.env.REWARDS_PRIVACY_NOTICE_VERSION = originalNotice;
  }
});

test('paid-order reversal creates one compensating ledger entry', async () => {
  const client = queuedClient([
    { rowCount: 1, rows: [{ id: 'ledger-id', sponsor_id: 'sponsor-id', referral_code_id: 'code-id', points_delta: 5 }] },
    { rowCount: 1, rows: [{ id: 'reversal-id' }] },
    { rowCount: 1, rows: [] },
    {
      rowCount: 1,
      rows: [{
        usage_count: 0,
        clicks: 0,
        shares: 0,
        conversions: 1,
        verified_reward_points: 0,
      }],
    },
    { rowCount: 1, rows: [] },
  ]);
  const result = await reverseVerifiedShopifyConversion(client, 'shopify-order-1');
  assert.equal(result.duplicate, false);
  assert.equal(client.calls[1].params[3], -5);
});

test('reversal arriving before payment creates an idempotent tombstone', async () => {
  const client = queuedClient([
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [] },
  ]);
  const result = await reverseVerifiedShopifyConversion(client, 'shopify-order-early-reversal');
  assert.equal(result, null);
  assert.match(client.calls[1].text, /pending_shopify_reward_reversals/);
});

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { Pool } = require('pg');
const { priceAndReserveItems } = require('../src/services/orderPricing');
const {
  hashRewardIdentity,
  recordVerifiedShopifyConversion,
  reverseVerifiedShopifyConversion,
} = require('../src/services/rewards');

const connectionString = process.env.TEST_DATABASE_URL;
const integrationTest = connectionString ? test : test.skip;
const pool = connectionString ? new Pool({ connectionString }) : null;

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

integrationTest('concurrent payment and reversal cannot leave a positive reward', async () => {
  const suffix = crypto.randomUUID();
  const sponsorId = crypto.randomUUID();
  const code = `WD-RACE-${suffix}`;
  const orderId = `order-${suffix}`;
  const previousRewardsFlag = process.env.CRUMB_SAVER_REWARDS_ENABLED;
  const previousSalt = process.env.REWARD_REFERENCE_SALT;
  const previousNotice = process.env.REWARDS_PRIVACY_NOTICE_VERSION;
  process.env.CRUMB_SAVER_REWARDS_ENABLED = 'true';
  process.env.REWARD_REFERENCE_SALT = 'integration-test-reward-reference-salt';
  process.env.REWARDS_PRIVACY_NOTICE_VERSION = '2026-09';

  await pool.query(
    `INSERT INTO sponsors
       (id, name, email, password_hash, referral_code, tier, rewards_consent,
        rewards_consent_at, privacy_notice_version, reward_identity_hash)
     VALUES ($1, 'Race Sponsor', $2, 'unused', $3, 'crumb', true, NOW(), '2026-09', $4)`,
    [
      sponsorId,
      `race-${suffix}@example.test`,
      code,
      hashRewardIdentity('shopify', '1001'),
    ]
  );
  await pool.query(
    'INSERT INTO referral_codes (sponsor_id, code_string) VALUES ($1, $2)',
    [sponsorId, code]
  );

  try {
    const results = await Promise.allSettled([
      inTransaction((client) => recordVerifiedShopifyConversion(client, {
        code,
        orderId,
        purchaserIdentity: { provider: 'shopify', subject: '2001' },
      })),
      inTransaction((client) => reverseVerifiedShopifyConversion(client, orderId)),
    ]);
    assert.equal(results.every((result) => result.status === 'fulfilled'), true);

    const ledger = await pool.query(
      `SELECT COALESCE(SUM(points_delta), 0)::numeric AS points
       FROM reward_ledger
       WHERE source_reference = $1`,
      [orderId]
    );
    assert.equal(Number(ledger.rows[0].points), 0);
  } finally {
    await pool.query('DELETE FROM pending_shopify_reward_reversals WHERE shopify_order_id = $1', [orderId]);
    await pool.query('DELETE FROM sponsors WHERE id = $1', [sponsorId]);
    if (previousRewardsFlag === undefined) delete process.env.CRUMB_SAVER_REWARDS_ENABLED;
    else process.env.CRUMB_SAVER_REWARDS_ENABLED = previousRewardsFlag;
    if (previousSalt === undefined) delete process.env.REWARD_REFERENCE_SALT;
    else process.env.REWARD_REFERENCE_SALT = previousSalt;
    if (previousNotice === undefined) delete process.env.REWARDS_PRIVACY_NOTICE_VERSION;
    else process.env.REWARDS_PRIVACY_NOTICE_VERSION = previousNotice;
  }
});

integrationTest('concurrent reservations cannot oversell inventory', async () => {
  const productId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO products
       (id, name, base_cost, markup_percent, inventory_count, active, print_methods)
     VALUES ($1, 'Concurrency Product', 10, 0, 1, true, '{}')`,
    [productId]
  );

  try {
    const reserve = () => inTransaction((client) => priceAndReserveItems(
      client,
      [{ productId, variantId: null, quantity: 1, customization: null }],
      0
    ));
    const results = await Promise.allSettled([reserve(), reserve()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);

    const product = await pool.query('SELECT inventory_count FROM products WHERE id = $1', [productId]);
    assert.equal(product.rows[0].inventory_count, 0);
  } finally {
    await pool.query('DELETE FROM products WHERE id = $1', [productId]);
  }
});

integrationTest('reservation rolls back when later order work fails', async () => {
  const productId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO products
       (id, name, base_cost, markup_percent, inventory_count, active, print_methods)
     VALUES ($1, 'Rollback Product', 10, 0, 1, true, '{}')`,
    [productId]
  );

  try {
    await assert.rejects(
      inTransaction(async (client) => {
        await priceAndReserveItems(
          client,
          [{ productId, variantId: null, quantity: 1, customization: null }],
          0
        );
        throw new Error('simulated order insert failure');
      }),
      /simulated order insert failure/
    );
    const product = await pool.query('SELECT inventory_count FROM products WHERE id = $1', [productId]);
    assert.equal(product.rows[0].inventory_count, 1);
  } finally {
    await pool.query('DELETE FROM products WHERE id = $1', [productId]);
  }
});

test.after(async () => {
  if (pool) await pool.end();
});

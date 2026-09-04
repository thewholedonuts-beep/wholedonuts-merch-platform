const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const environmentPath = path.resolve(__dirname, '../src/config/environment.js');
const productionValues = {
  DATABASE_URL: 'postgres://localhost/wholedonuts_merch',
  JWT_SECRET: 'a'.repeat(32),
  OPERATOR_API_KEY: 'b'.repeat(32),
  FRONTEND_URLS: 'https://merch.example.test',
  SHOPIFY_STORE_URL: 'whole-donuts.myshopify.com',
  SHOPIFY_API_VERSION: '2026-07',
  SHOPIFY_ACCESS_TOKEN: 'shopify-token',
  SHOPIFY_WEBHOOK_SECRET: 'webhook-secret',
  SHOPIFY_WEBHOOK_TOPICS: 'orders/create,orders/updated,fulfillments/create,fulfillments/update',
  PUBLIC_API_URL: 'https://api.example.test',
  RATE_LIMIT_KEY_SALT: 'e'.repeat(32),
  PRINTFUL_API_KEY: 'printful-token',
  PRINTFUL_STORE_ID: '12345',
};
const environmentKeys = [
  'ALLOW_PRINTIFY_FULFILLMENT',
  'ALLOW_SPONSOR_SELF_REGISTRATION',
  'CRUMB_SAVER_REWARDS_ENABLED',
  'DATABASE_ALLOW_INSECURE_TLS',
  'DATABASE_URL',
  'DATABASE_SSL_REJECT_UNAUTHORIZED',
  'DEFAULT_FULFILLMENT_PROVIDER',
  'FULFILLMENT_PROVIDERS',
  'FRONTEND_URLS',
  'IP_HASH_SALT',
  'JWT_SECRET',
  'NODE_ENV',
  'OPERATOR_API_KEY',
  'PRINTIFY_API_KEY',
  'PRINTIFY_SHOP_ID',
  'PRINTFUL_API_KEY',
  'PRINTFUL_STORE_ID',
  'PUBLIC_API_URL',
  'RATE_LIMIT_KEY_SALT',
  'REWARD_REFERENCE_SALT',
  'REWARDS_PRIVACY_NOTICE_VERSION',
  'REFERRAL_ANALYTICS_ENABLED',
  'SHOPIFY_ACCESS_TOKEN',
  'SHOPIFY_API_VERSION',
  'SHOPIFY_STORE_URL',
  'SHOPIFY_WEBHOOK_SECRET',
  'SHOPIFY_WEBHOOK_TOPICS',
];

function withEnvironment(values, work) {
  const original = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of environmentKeys) {
      if (values[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = values[key];
      }
    }
    delete require.cache[environmentPath];
    return work(require(environmentPath));
  } finally {
    for (const key of environmentKeys) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
    delete require.cache[environmentPath];
  }
}

test('production does not require a referral IP salt while analytics are disabled', { concurrency: false }, () => {
  withEnvironment({
    ...productionValues,
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    NODE_ENV: 'production',
    REFERRAL_ANALYTICS_ENABLED: 'false',
  }, ({ validateProductionEnvironment }) => {
    assert.doesNotThrow(validateProductionEnvironment);
  });
});

test('production requires a referral IP salt only when analytics are enabled', { concurrency: false }, () => {
  withEnvironment({
    ...productionValues,
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    NODE_ENV: 'production',
    REFERRAL_ANALYTICS_ENABLED: 'true',
    REWARD_REFERENCE_SALT: 'c'.repeat(32),
  }, ({ validateProductionEnvironment }) => {
    assert.throws(validateProductionEnvironment, /IP_HASH_SALT/);
  });
});

test('production requires credentials for each enabled fulfillment provider', { concurrency: false }, () => {
  withEnvironment({
    ...productionValues,
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    NODE_ENV: 'production',
    FULFILLMENT_PROVIDERS: 'printful,printify',
    ALLOW_PRINTIFY_FULFILLMENT: 'true',
  }, ({ validateProductionEnvironment }) => {
    assert.throws(validateProductionEnvironment, /PRINTIFY_API_KEY/);
  });
});

test('production launch rejects Printify unless separately approved', { concurrency: false }, () => {
  withEnvironment({
    ...productionValues,
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    NODE_ENV: 'production',
    FULFILLMENT_PROVIDERS: 'printful,printify',
    PRINTIFY_API_KEY: 'printify-token',
    PRINTIFY_SHOP_ID: 'printify-shop',
  }, ({ validateProductionEnvironment }) => {
    assert.throws(validateProductionEnvironment, /Printify is not enabled for launch/);
  });
});

test('production requires the complete supported Shopify webhook topic set', { concurrency: false }, () => {
  withEnvironment({
    ...productionValues,
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    NODE_ENV: 'production',
    SHOPIFY_WEBHOOK_TOPICS: 'orders/create',
  }, ({ validateProductionEnvironment }) => {
    assert.throws(validateProductionEnvironment, /SHOPIFY_WEBHOOK_TOPICS must contain exactly/);
  });
});

test('production requires a valid public HTTPS API origin', { concurrency: false }, () => {
  withEnvironment({
    ...productionValues,
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    NODE_ENV: 'production',
    PUBLIC_API_URL: 'http://api.example.test/path',
  }, ({ validateProductionEnvironment }) => {
    assert.throws(validateProductionEnvironment, /PUBLIC_API_URL must be/);
  });
});

test('enabled rewards require a server-approved notice version and hashing salt', { concurrency: false }, () => {
  withEnvironment({
    ...productionValues,
    CRUMB_SAVER_REWARDS_ENABLED: 'true',
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    NODE_ENV: 'production',
  }, ({ validateProductionEnvironment }) => {
    assert.throws(validateProductionEnvironment, /REWARD_REFERENCE_SALT/);
  });
});

test('enabled rewards validate when the approved notice and secrets are configured', { concurrency: false }, () => {
  withEnvironment({
    ...productionValues,
    CRUMB_SAVER_REWARDS_ENABLED: 'true',
    DATABASE_SSL_REJECT_UNAUTHORIZED: 'true',
    NODE_ENV: 'production',
    REWARD_REFERENCE_SALT: 'd'.repeat(32),
    REWARDS_PRIVACY_NOTICE_VERSION: '2026-09',
  }, ({ validateProductionEnvironment }) => {
    assert.doesNotThrow(validateProductionEnvironment);
  });
});

test('public collection features require explicit opt-in', { concurrency: false }, () => {
  withEnvironment({}, ({ referralAnalyticsEnabled, selfRegistrationEnabled }) => {
    assert.equal(referralAnalyticsEnabled(), false);
    assert.equal(selfRegistrationEnabled(), false);
  });
});

test('self-registration is enabled only by its explicit setting', { concurrency: false }, () => {
  withEnvironment({
    ALLOW_SPONSOR_SELF_REGISTRATION: 'true',
  }, ({ selfRegistrationEnabled }) => {
    assert.equal(selfRegistrationEnabled(), true);
  });
});

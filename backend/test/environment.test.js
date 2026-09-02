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
  SHOPIFY_ACCESS_TOKEN: 'shopify-token',
  SHOPIFY_WEBHOOK_SECRET: 'webhook-secret',
  PRINTFUL_API_KEY: 'printful-token',
};
const environmentKeys = [
  'ALLOW_SPONSOR_SELF_REGISTRATION',
  'DATABASE_ALLOW_INSECURE_TLS',
  'DATABASE_URL',
  'DATABASE_SSL_REJECT_UNAUTHORIZED',
  'FRONTEND_URLS',
  'IP_HASH_SALT',
  'JWT_SECRET',
  'NODE_ENV',
  'OPERATOR_API_KEY',
  'PRINTFUL_API_KEY',
  'REFERRAL_ANALYTICS_ENABLED',
  'SHOPIFY_ACCESS_TOKEN',
  'SHOPIFY_STORE_URL',
  'SHOPIFY_WEBHOOK_SECRET',
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
  }, ({ validateProductionEnvironment }) => {
    assert.throws(validateProductionEnvironment, /IP_HASH_SALT/);
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

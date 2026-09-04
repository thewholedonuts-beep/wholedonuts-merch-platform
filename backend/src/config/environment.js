const dotenv = require('dotenv');

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

function selfRegistrationEnabled() {
  return process.env.ALLOW_SPONSOR_SELF_REGISTRATION === 'true';
}

function referralAnalyticsEnabled() {
  return process.env.REFERRAL_ANALYTICS_ENABLED === 'true';
}

function rewardsEnabled() {
  return process.env.CRUMB_SAVER_REWARDS_ENABLED === 'true';
}

function approvedRewardsPrivacyNoticeVersion() {
  return process.env.REWARDS_PRIVACY_NOTICE_VERSION || '';
}

function fulfillmentProviders() {
  return String(process.env.FULFILLMENT_PROVIDERS || 'printful')
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
}

function shopifyWebhookTopics() {
  return String(process.env.SHOPIFY_WEBHOOK_TOPICS || '')
    .split(',')
    .map((topic) => topic.trim().toLowerCase())
    .filter(Boolean);
}

function parseOrigins(value) {
  const origins = String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.map((origin) => {
    const parsed = new URL(origin);
    if (isProduction && parsed.protocol !== 'https:') {
      throw new Error(`Production frontend origin must use HTTPS: ${origin}`);
    }
    return parsed.origin;
  });
}

function frontendOrigins() {
  return parseOrigins(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:3000');
}

function validateDatabaseEnvironment() {
  if (!isProduction) {
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('Missing required production environment variable: DATABASE_URL');
  }

  if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'false' && process.env.DATABASE_ALLOW_INSECURE_TLS !== 'true') {
    throw new Error('Set DATABASE_ALLOW_INSECURE_TLS=true only when explicitly accepting an unverified database certificate.');
  }
}

function validateProductionEnvironment() {
  if (!isProduction) {
    return;
  }

  validateDatabaseEnvironment();

  const required = [
    'JWT_SECRET',
    'OPERATOR_API_KEY',
    'FRONTEND_URLS',
    'SHOPIFY_STORE_URL',
    'SHOPIFY_API_VERSION',
    'SHOPIFY_ACCESS_TOKEN',
    'SHOPIFY_WEBHOOK_SECRET',
    'SHOPIFY_WEBHOOK_TOPICS',
    'PUBLIC_API_URL',
    'RATE_LIMIT_KEY_SALT',
  ];
  const providers = fulfillmentProviders();
  if (!providers.length || providers.some((provider) => !['printful', 'printify'].includes(provider))) {
    throw new Error('FULFILLMENT_PROVIDERS must contain printful, printify, or both.');
  }
  if (providers.includes('printful')) {
    required.push('PRINTFUL_API_KEY', 'PRINTFUL_STORE_ID');
  }
  if (providers.includes('printify')) {
    required.push('PRINTIFY_API_KEY', 'PRINTIFY_SHOP_ID');
  }
  if (referralAnalyticsEnabled()) {
    required.push('IP_HASH_SALT');
  }
  if (rewardsEnabled()) {
    required.push('REWARD_REFERENCE_SALT', 'REWARDS_PRIVACY_NOTICE_VERSION');
  }
  const missing = required.filter((name) => !process.env[name]);

  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }

  const minimumLengthSecrets = ['JWT_SECRET', 'OPERATOR_API_KEY', 'RATE_LIMIT_KEY_SALT'];
  if (referralAnalyticsEnabled()) {
    minimumLengthSecrets.push('IP_HASH_SALT');
  }
  if (rewardsEnabled()) {
    minimumLengthSecrets.push('REWARD_REFERENCE_SALT');
  }

  minimumLengthSecrets.forEach((name) => {
    if (String(process.env[name]).length < 32) {
      throw new Error(`${name} must be at least 32 characters in production.`);
    }
  });

  frontendOrigins();

  if (!/^[a-z0-9][a-z0-9.-]*\.myshopify\.com$/i.test(process.env.SHOPIFY_STORE_URL)) {
    throw new Error('SHOPIFY_STORE_URL must be a Shopify store hostname without a protocol or path.');
  }
  if (!/^\d{4}-(01|04|07|10)$/.test(process.env.SHOPIFY_API_VERSION)) {
    throw new Error('SHOPIFY_API_VERSION must be a supported YYYY-MM stable API version.');
  }

  let publicApiUrl;
  try {
    publicApiUrl = new URL(process.env.PUBLIC_API_URL);
  } catch {
    throw new Error('PUBLIC_API_URL must be a valid HTTPS origin without a path, query, or fragment.');
  }
  if (publicApiUrl.protocol !== 'https:' || publicApiUrl.origin !== publicApiUrl.href.replace(/\/$/, '')) {
    throw new Error('PUBLIC_API_URL must be an HTTPS origin without a path, query, or fragment.');
  }

  const requiredWebhookTopics = [
    'orders/create',
    'orders/updated',
    'fulfillments/create',
    'fulfillments/update',
  ];
  const configuredWebhookTopics = shopifyWebhookTopics();
  const invalidWebhookTopics = configuredWebhookTopics.filter((topic) => !requiredWebhookTopics.includes(topic));
  const missingWebhookTopics = requiredWebhookTopics.filter((topic) => !configuredWebhookTopics.includes(topic));
  if (
    invalidWebhookTopics.length
    || missingWebhookTopics.length
    || new Set(configuredWebhookTopics).size !== requiredWebhookTopics.length
  ) {
    throw new Error(
      `SHOPIFY_WEBHOOK_TOPICS must contain exactly: ${requiredWebhookTopics.join(', ')}.`
    );
  }

  const defaultProvider = String(process.env.DEFAULT_FULFILLMENT_PROVIDER || providers[0]).toLowerCase();
  if (!providers.includes('printful') || defaultProvider !== 'printful') {
    throw new Error('Production fulfillment must include printful and DEFAULT_FULFILLMENT_PROVIDER must be printful.');
  }
  if (providers.includes('printify') && process.env.ALLOW_PRINTIFY_FULFILLMENT !== 'true') {
    throw new Error('Printify is not enabled for launch. Set ALLOW_PRINTIFY_FULFILLMENT=true only after a separate provider review.');
  }
}

function trustProxySetting() {
  const value = process.env.TRUST_PROXY;
  if (value === undefined) {
    return isProduction ? 1 : false;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error('TRUST_PROXY must be a non-negative proxy hop count.');
  }
  return Number(value);
}

module.exports = {
  frontendOrigins,
  fulfillmentProviders,
  shopifyWebhookTopics,
  approvedRewardsPrivacyNoticeVersion,
  isProduction,
  referralAnalyticsEnabled,
  rewardsEnabled,
  selfRegistrationEnabled,
  trustProxySetting,
  validateDatabaseEnvironment,
  validateProductionEnvironment,
};

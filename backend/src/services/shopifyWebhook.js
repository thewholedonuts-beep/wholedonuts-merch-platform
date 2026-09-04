const crypto = require('crypto');
const { shopifyWebhookTopics } = require('../config/environment');

function verifyShopifyWebhook(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) {
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'base64');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function allowedShopifyTopics() {
  const configuredTopics = shopifyWebhookTopics();
  return configuredTopics.length
    ? configuredTopics
    : ['orders/create', 'orders/updated', 'fulfillments/create', 'fulfillments/update'];
}

function webhookKind(topic) {
  if (['orders/create', 'orders/updated'].includes(topic)) return 'order';
  if (['fulfillments/create', 'fulfillments/update'].includes(topic)) return 'fulfillment';
  return null;
}

function mapOrderFulfillmentStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'fulfilled') return 'shipped';
  if (normalized === 'partial' || normalized === 'in_progress') return 'processing';
  if (normalized === 'restocked') return 'cancelled';
  return 'pending';
}

function mapFulfillmentStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'success') return 'shipped';
  if (normalized === 'cancelled') return 'cancelled';
  return 'processing';
}

function isPaidOrder(payload) {
  return String(payload?.financial_status || '').toLowerCase() === 'paid';
}

function isReversedOrder(payload) {
  const financialStatus = String(payload?.financial_status || '').toLowerCase();
  return ['refunded', 'voided'].includes(financialStatus) || Boolean(payload?.cancelled_at);
}

module.exports = {
  allowedShopifyTopics,
  isPaidOrder,
  isReversedOrder,
  mapFulfillmentStatus,
  mapOrderFulfillmentStatus,
  verifyShopifyWebhook,
  webhookKind,
};

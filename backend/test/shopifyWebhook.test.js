const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  isPaidOrder,
  isReversedOrder,
  mapFulfillmentStatus,
  mapOrderFulfillmentStatus,
  verifyShopifyWebhook,
  webhookKind,
} = require('../src/services/shopifyWebhook');

test('accepts a valid Shopify HMAC for the original bytes', () => {
  const secret = 'a test webhook secret';
  const body = Buffer.from('{"id":42,"note":"cafe"}');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');

  assert.equal(verifyShopifyWebhook(body, signature, secret), true);
});

test('rejects a signature generated for different webhook bytes', () => {
  const secret = 'a test webhook secret';
  const body = Buffer.from('{"id":42}');
  const signature = crypto.createHmac('sha256', secret).update(Buffer.from('{"id":43}')).digest('base64');

  assert.equal(verifyShopifyWebhook(body, signature, secret), false);
});

test('separates order and fulfillment webhook payloads', () => {
  assert.equal(webhookKind('orders/updated'), 'order');
  assert.equal(webhookKind('fulfillments/update'), 'fulfillment');
  assert.equal(webhookKind('refunds/create'), null);
});

test('maps Shopify statuses into the internal fulfillment enum', () => {
  assert.equal(mapOrderFulfillmentStatus('fulfilled'), 'shipped');
  assert.equal(mapOrderFulfillmentStatus('partial'), 'processing');
  assert.equal(mapOrderFulfillmentStatus(null), 'pending');
  assert.equal(mapFulfillmentStatus('success'), 'shipped');
  assert.equal(mapFulfillmentStatus('cancelled'), 'cancelled');
  assert.equal(mapFulfillmentStatus('failure'), 'processing');
});

test('awards only paid orders and recognizes reversals', () => {
  assert.equal(isPaidOrder({ financial_status: 'paid' }), true);
  assert.equal(isPaidOrder({ financial_status: 'authorized' }), false);
  assert.equal(isReversedOrder({ financial_status: 'refunded' }), true);
  assert.equal(isReversedOrder({ cancelled_at: '2026-09-04T00:00:00Z' }), true);
  assert.equal(isReversedOrder({ financial_status: 'paid' }), false);
});

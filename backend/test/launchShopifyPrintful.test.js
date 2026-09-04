const assert = require('node:assert/strict');
const test = require('node:test');
const {
  evaluateMappings,
  verifyDeployedWebhookReceiver,
  webhookCallbackUrl,
} = require('../src/scripts/launchShopifyPrintful');
const { verifyShopifyWebhook } = require('../src/services/shopifyWebhook');

test('webhook callback is derived from the production API origin', () => {
  assert.equal(
    webhookCallbackUrl('https://api.example.test/'),
    'https://api.example.test/api/orders/webhook/shopify'
  );
});

test('mapped Printful product and variant satisfy launch mapping checks', () => {
  const rows = [{
    product_id: 'product-1',
    shopify_product_id: '101',
    fulfillment_provider: 'printful',
    fulfillment_product_id: '201',
    requires_signature_branding: true,
    signature_text: 'Made By +U, 4 ALL',
    signature_placement: 'left-side-or-sleeve',
    variant_id: 'variant-1',
    shopify_variant_id: '301',
    fulfillment_variant_id: '401',
    fulfillment_branding_file_id: '501',
    fulfillment_branding_placement: 'sleeve_left',
  }];
  const remote = new Map([['201', {
    syncProduct: { external_id: '101' },
    syncVariants: [{
      id: 401,
      external_id: '301',
      synced: true,
      files: [{ id: 501, type: 'sleeve_left' }],
    }],
  }]]);

  assert.deepEqual(evaluateMappings(rows, remote), []);
});

test('signed readiness probe proves the deployed receiver uses the configured secret', { concurrency: false }, async () => {
  const originalFetch = global.fetch;
  const originalApiUrl = process.env.PUBLIC_API_URL;
  const originalSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const requests = [];
  process.env.PUBLIC_API_URL = 'https://api.example.test';
  process.env.SHOPIFY_WEBHOOK_SECRET = 'shopify-webhook-test-secret';
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    const valid = verifyShopifyWebhook(
      options.body,
      options.headers['X-Shopify-Hmac-Sha256'],
      process.env.SHOPIFY_WEBHOOK_SECRET
    );
    return {
      status: valid ? 400 : 401,
      json: async () => ({
        error: valid ? 'Unsupported Shopify webhook topic.' : 'Invalid Shopify webhook signature.',
      }),
    };
  };

  try {
    await verifyDeployedWebhookReceiver();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://api.example.test/api/orders/webhook/shopify');
    assert.equal(requests[0].options.headers['X-Shopify-Topic'], 'whole-donuts/readiness');
    assert.equal(
      verifyShopifyWebhook(
        requests[0].options.body,
        requests[0].options.headers['X-Shopify-Hmac-Sha256'],
        process.env.SHOPIFY_WEBHOOK_SECRET
      ),
      false
    );
    assert.equal(
      verifyShopifyWebhook(
        requests[1].options.body,
        requests[1].options.headers['X-Shopify-Hmac-Sha256'],
        process.env.SHOPIFY_WEBHOOK_SECRET
      ),
      true
    );
  } finally {
    global.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = originalApiUrl;
    if (originalSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = originalSecret;
  }
});

test('launch mapping checks reject a Printful variant that is not synced', () => {
  const errors = evaluateMappings([{
    product_id: 'product-1',
    shopify_product_id: '101',
    fulfillment_provider: 'printful',
    fulfillment_product_id: '201',
    requires_signature_branding: true,
    signature_text: 'Made By +U, 4 ALL',
    signature_placement: 'left-side-or-sleeve',
    variant_id: 'variant-1',
    shopify_variant_id: '301',
    fulfillment_variant_id: '401',
  }], new Map([['201', {
    syncProduct: { external_id: '101' },
    syncVariants: [{ id: 401, external_id: '301', synced: false }],
  }]]));

  assert.equal(errors.some((error) => error.includes('does not match')), true);
});

test('launch mapping checks reject missing branding and variant mappings', () => {
  const errors = evaluateMappings([{
    product_id: 'product-1',
    shopify_product_id: '101',
    fulfillment_provider: 'printful',
    fulfillment_product_id: '201',
    requires_signature_branding: false,
    signature_text: 'Made By +U, 4 ALL',
    signature_placement: 'left-side-or-sleeve',
    variant_id: 'variant-1',
    shopify_variant_id: '301',
    fulfillment_variant_id: null,
  }], new Map([['201', {
    syncProduct: { external_id: '101' },
    syncVariants: [],
  }]]));

  assert.equal(errors.some((error) => error.includes('mandatory Made By +U, 4 ALL')), true);
  assert.equal(errors.some((error) => error.includes('missing its Shopify or Printful mapping')), true);
});

test('launch mapping checks reject an unapproved remote branding file', () => {
  const errors = evaluateMappings([{
    product_id: 'product-1',
    shopify_product_id: '101',
    fulfillment_provider: 'printful',
    fulfillment_product_id: '201',
    requires_signature_branding: true,
    signature_text: 'Made By +U, 4 ALL',
    signature_placement: 'left-side-or-sleeve',
    variant_id: 'variant-1',
    shopify_variant_id: '301',
    fulfillment_variant_id: '401',
    fulfillment_branding_file_id: '501',
    fulfillment_branding_placement: 'sleeve_left',
  }], new Map([['201', {
    syncProduct: { external_id: '101' },
    syncVariants: [{
      id: 401,
      external_id: '301',
      synced: true,
      files: [{ id: 999, type: 'sleeve_left' }],
    }],
  }]]));

  assert.equal(errors.some((error) => error.includes('owner-approved remote Printful branding file')), true);
});

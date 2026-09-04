const assert = require('node:assert/strict');
const test = require('node:test');
const {
  evaluateMappings,
  webhookCallbackUrl,
} = require('../src/scripts/launchShopifyPrintful');

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
  }];
  const remote = new Map([['201', {
    syncProduct: { external_id: '101' },
    syncVariants: [{ id: 401, external_id: '301', synced: true }],
  }]]);

  assert.deepEqual(evaluateMappings(rows, remote), []);
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

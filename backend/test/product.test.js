const assert = require('node:assert/strict');
const test = require('node:test');
const {
  calculateCustomizationPrice,
  positiveInteger,
  toConsumerProduct,
  toFulfillmentCustomization,
  validateFulfillmentMappingPayload,
  validateFulfillmentProvider,
} = require('../src/utils/product');

test('consumer product DTO excludes cost and provider identifiers', () => {
  const dto = toConsumerProduct({
    id: 'product-id',
    name: 'Shirt',
    description: 'A shirt',
    final_price: '24.00',
    base_cost: '20.00',
    markup_percent: '20',
    category: 'apparel',
    print_methods: ['DTG'],
    available_colors: [],
    customization_options: {},
    inventory_count: 3,
    shopify_product_id: 'shopify-id',
    printful_product_id: 'printful-id',
    fulfillment_product_id: 'provider-id',
    fulfillment_provider: 'printful',
    requires_signature_branding: true,
  });

  assert.equal(dto.price, 24);
  assert.equal(dto.mandatoryBranding.text, 'Made By +U, 4 ALL');
  assert.equal(dto.mandatoryBranding.removable, false);
  for (const key of ['base_cost', 'markup_percent', 'shopify_product_id', 'printful_product_id', 'fulfillment_product_id', 'fulfillment_provider']) {
    assert.equal(Object.hasOwn(dto, key), false);
  }
});

test('fulfillment customization cannot remove mandatory branding', () => {
  const mandatoryBranding = {
    text: 'Made By +U, 4 ALL',
    placement: 'left-side-or-sleeve',
    removable: false,
  };
  const customization = toFulfillmentCustomization({
    text: 'Hello',
    mandatoryBranding: null,
    providerInstructions: 'skip signature',
  }, mandatoryBranding);
  assert.deepEqual(customization.mandatoryBranding, mandatoryBranding);
  assert.equal(Object.hasOwn(customization, 'providerInstructions'), false);
});

test('quantity must be a positive integer', () => {
  assert.equal(positiveInteger(2), 2);
  assert.throws(() => positiveInteger(0), /positive integer/);
  assert.throws(() => positiveInteger(-1), /positive integer/);
  assert.throws(() => positiveInteger(1.5), /positive integer/);
});

test('customization pricing ignores client price and enforces branding', () => {
  const price = calculateCustomizationPrice({
    final_price: 24,
    markup_percent: 20,
    print_methods: ['DTG'],
    customization_options: {
      logoPlacementFee: 3,
      textFee: 2,
      printMethodFees: { DTG: 6 },
    },
    requires_signature_branding: true,
  }, {
    unitPrice: 0.01,
    logoPlacements: ['front'],
    text: 'Hello',
    printMethod: 'DTG',
    mandatoryBranding: null,
  });

  assert.equal(price.finalPrice, 37.2);
  assert.deepEqual(price.mandatoryBranding, {
    text: 'Made By +U, 4 ALL',
    placement: 'left-side-or-sleeve',
    removable: false,
  });
});

test('fulfillment provider selection is explicit', () => {
  assert.equal(validateFulfillmentProvider('PRINTFUL'), 'printful');
  assert.equal(validateFulfillmentProvider('printify'), 'printify');
  assert.throws(() => validateFulfillmentProvider('other'), /printful or printify/);
});

test('fulfillment mapping normalizes IDs and rejects duplicate variants', () => {
  assert.deepEqual(validateFulfillmentMappingPayload({
    fulfillmentProductId: 201,
    variants: [{ variantId: 'variant-1', fulfillmentVariantId: 401 }],
  }), {
    fulfillmentProductId: '201',
    variants: [{ variantId: 'variant-1', fulfillmentVariantId: '401' }],
  });
  assert.throws(
    () => validateFulfillmentMappingPayload({
      fulfillmentProductId: '201',
      variants: [
        { variantId: 'variant-1', fulfillmentVariantId: '401' },
        { variantId: 'variant-1', fulfillmentVariantId: '402' },
      ],
    }),
    /Duplicate variant mapping/
  );
});

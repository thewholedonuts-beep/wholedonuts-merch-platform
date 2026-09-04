const assert = require('node:assert/strict');
const test = require('node:test');
const {
  enabledFulfillmentProviders,
  getFulfillmentAdapter,
} = require('../src/services/fulfillment');

test('enabled fulfillment providers are normalized and ordered', () => {
  const original = process.env.FULFILLMENT_PROVIDERS;
  process.env.FULFILLMENT_PROVIDERS = 'PRINTFUL, printify';
  try {
    assert.deepEqual(enabledFulfillmentProviders(), ['printful', 'printify']);
  } finally {
    if (original === undefined) delete process.env.FULFILLMENT_PROVIDERS;
    else process.env.FULFILLMENT_PROVIDERS = original;
  }
});

test('provider registry exposes both supported adapters', () => {
  for (const provider of ['printful', 'printify']) {
    const adapter = getFulfillmentAdapter(provider);
    assert.equal(typeof adapter.getStatus, 'function');
    assert.equal(typeof adapter.listCatalog, 'function');
  }
});

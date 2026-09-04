const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeOrderItems, priceAndReserveItems } = require('../src/services/orderPricing');

function queuedClient(results) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      const result = results.shift();
      if (!result) throw new Error(`Unexpected query: ${text}`);
      return result;
    },
  };
}

test('normalizes only positive integer quantities', () => {
  assert.equal(normalizeOrderItems([{ productId: 'p', quantity: 2 }])[0].quantity, 2);
  assert.throws(() => normalizeOrderItems([{ productId: 'p', quantity: 0 }]), /positive integer/);
  assert.throws(() => normalizeOrderItems([{ productId: 'p', quantity: 1.5 }]), /positive integer/);
});

test('normalizes item lock order to avoid cross-product deadlocks', () => {
  const items = normalizeOrderItems([
    { productId: 'product-z', quantity: 1 },
    { productId: 'product-a', quantity: 1 },
  ]);
  assert.deepEqual(items.map((item) => item.productId), ['product-a', 'product-z']);
});

test('rejects zero and excess product inventory while holding a row lock', async () => {
  for (const inventory of [0, 1]) {
    const client = queuedClient([
      {
        rowCount: 1,
        rows: [{
          id: 'product-id',
          name: 'Shirt',
          final_price: 20,
          markup_percent: 20,
          print_methods: [],
          customization_options: {},
          requires_signature_branding: false,
          inventory_count: inventory,
        }],
      },
      { rowCount: 0, rows: [] },
    ]);
    await assert.rejects(
      priceAndReserveItems(client, [{ productId: 'product-id', variantId: null, quantity: 2, customization: null }], 0),
      /Insufficient inventory/
    );
    assert.match(client.calls[0].text, /FOR UPDATE/);
    assert.equal(client.calls.length, 2);
  }
});

test('reserves authoritative variant and aggregate inventory', async () => {
  const client = queuedClient([
    {
      rowCount: 1,
      rows: [{
        id: 'product-id',
        name: 'Shirt',
        final_price: 20,
        markup_percent: 20,
        print_methods: [],
        customization_options: {},
        requires_signature_branding: true,
        inventory_count: 3,
      }],
    },
    {
      rowCount: 1,
      rows: [{ id: 'variant-id', title: 'Small', sku: 'S', price: 25, inventory_count: 2 }],
    },
    { rowCount: 1, rows: [] },
    { rowCount: 1, rows: [] },
  ]);
  const result = await priceAndReserveItems(
    client,
    [{ productId: 'product-id', variantId: 'variant-id', quantity: 2, customization: null }],
    0
  );
  assert.equal(result.total, 50);
  assert.match(client.calls[1].text, /FOR UPDATE/);
  assert.match(client.calls[2].text, /inventory_count = inventory_count -/);
  assert.match(client.calls[3].text, /inventory_count = inventory_count -/);
});

test('rejects a selected variant with insufficient inventory even when aggregate stock remains', async () => {
  const client = queuedClient([
    {
      rowCount: 1,
      rows: [{
        id: 'product-id',
        name: 'Shirt',
        final_price: 20,
        markup_percent: 20,
        print_methods: [],
        customization_options: {},
        requires_signature_branding: false,
        inventory_count: 10,
      }],
    },
    {
      rowCount: 1,
      rows: [{ id: 'variant-id', title: 'Small', sku: 'S', price: 25, inventory_count: 0 }],
    },
  ]);
  await assert.rejects(
    priceAndReserveItems(
      client,
      [{ productId: 'product-id', variantId: 'variant-id', quantity: 1, customization: null }],
      0
    ),
    /Insufficient inventory/
  );
  assert.equal(client.calls.length, 2);
});

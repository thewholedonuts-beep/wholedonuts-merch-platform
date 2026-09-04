const {
  calculateCustomizationPrice,
  positiveInteger,
  toFulfillmentCustomization,
} = require('../utils/product');

function normalizeOrderItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('At least one order item is required.');
  }
  return items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId || null,
    quantity: positiveInteger(item.quantity),
    customization: item.customization || null,
  })).sort((left, right) => (
    `${left.productId}:${left.variantId || ''}`.localeCompare(`${right.productId}:${right.variantId || ''}`)
  ));
}

async function priceAndReserveItems(client, items, discountApplied) {
  let subtotal = 0;
  const pricedItems = [];

  for (const item of items) {
    const productResult = await client.query(
      `SELECT id, name, final_price, markup_percent, print_methods, customization_options,
              requires_signature_branding, inventory_count
       FROM products
       WHERE id = $1 AND active = true
       FOR UPDATE`,
      [item.productId]
    );
    if (!productResult.rowCount) {
      throw new Error(`Active product ${item.productId} not found.`);
    }

    const product = productResult.rows[0];
    const variants = await client.query(
      `SELECT id, title, sku, price, inventory_count
       FROM product_variants
       WHERE product_id = $1 AND active = true
       ORDER BY id
       FOR UPDATE`,
      [product.id]
    );
    let variant = null;
    if (item.variantId) {
      variant = variants.rows.find((candidate) => candidate.id === item.variantId);
      if (!variant) {
        throw new Error(`Variant ${item.variantId} is not available for product ${item.productId}.`);
      }
    } else if (variants.rowCount) {
      throw new Error(`A variant is required for product ${item.productId}.`);
    }

    const productInventory = Number(product.inventory_count);
    const variantInventory = variant ? Number(variant.inventory_count) : productInventory;
    if (
      !Number.isSafeInteger(productInventory)
      || !Number.isSafeInteger(variantInventory)
      || productInventory < item.quantity
      || variantInventory < item.quantity
    ) {
      throw new Error(`Insufficient inventory for product ${item.productId}.`);
    }

    if (variant) {
      await client.query(
        `UPDATE product_variants
         SET inventory_count = inventory_count - $2,
             updated_at = NOW()
         WHERE id = $1`,
        [variant.id, item.quantity]
      );
    }
    await client.query(
      `UPDATE products
       SET inventory_count = inventory_count - $2,
           updated_at = NOW()
       WHERE id = $1`,
      [product.id, item.quantity]
    );

    const pricing = calculateCustomizationPrice(product, item.customization || {}, variant);
    const unitPrice = pricing.finalPrice;
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;
    pricedItems.push({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      customization: toFulfillmentCustomization(item.customization || {}, pricing.mandatoryBranding),
      productName: product.name,
      unitPrice: Number(unitPrice.toFixed(2)),
      lineTotal: Number(lineTotal.toFixed(2)),
      pricing,
    });
  }

  const total = Math.max(subtotal - subtotal * (Number(discountApplied) || 0), 0);
  return {
    subtotal: Number(subtotal.toFixed(2)),
    total: Number(total.toFixed(2)),
    items: pricedItems,
  };
}

module.exports = {
  normalizeOrderItems,
  priceAndReserveItems,
};

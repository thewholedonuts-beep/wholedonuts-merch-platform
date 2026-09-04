const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { enabledFulfillmentProviders } = require('../services/fulfillment');
const { validateFulfillmentProvider } = require('../utils/product');

const router = express.Router();

function shopifyHeaders() {
  if (!process.env.SHOPIFY_STORE_URL || !process.env.SHOPIFY_ACCESS_TOKEN) {
    throw new Error('Shopify credentials are not configured.');
  }

  return {
    baseUrl: `https://${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION || '2026-07'}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
    },
  };
}

router.post('/sync-products', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { baseUrl, headers } = shopifyHeaders();
    const response = await fetch(`${baseUrl}/products.json?limit=50`, { headers });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to sync Shopify products.' });
    }

    const data = await response.json();
    const syncedProducts = [];

    for (const product of data.products || []) {
      const baseCost = Number(product.variants?.[0]?.price || 0) / 1.2 || 10;
      const customizationOptions = {
        printMethodFees: {
          embroidery: 8,
          'screen print': 5,
          DTG: 6,
        },
        logoPlacementFee: 3,
        textFee: 2,
      };

      const inventoryCount = (product.variants || []).reduce((sum, variant) => sum + Number(variant.inventory_quantity || 0), 0);
      const existing = await query('SELECT id FROM products WHERE shopify_product_id = $1', [String(product.id)]);
      const fulfillmentProvider = validateFulfillmentProvider(
        process.env.DEFAULT_FULFILLMENT_PROVIDER || enabledFulfillmentProviders()[0]
      );
      const params = [
        product.title,
        product.body_html || product.title,
        baseCost,
        product.product_type || 'merch',
        ['embroidery', 'screen print', 'DTG'],
        JSON.stringify((product.options?.[0]?.values || []).map((value) => ({ name: value }))),
        JSON.stringify(customizationOptions),
        String(product.id),
        inventoryCount,
      ];

      const syncedProduct = await withTransaction(async (client) => {
        const upsert = existing.rowCount
          ? await client.query(
            `UPDATE products
             SET name = $1,
                 description = $2,
                 base_cost = $3,
                 category = $4,
                 print_methods = $5,
                 available_colors = $6::jsonb,
                 customization_options = $7::jsonb,
                 inventory_count = $9,
                 updated_at = NOW()
             WHERE shopify_product_id = $8
             RETURNING *`,
            params
            )
          : await client.query(
            `INSERT INTO products (name, description, base_cost, markup_percent, category, print_methods, available_colors, customization_options, shopify_product_id, inventory_count, active, fulfillment_provider, requires_signature_branding)
            VALUES ($1, $2, $3, 20, $4, $5, $6::jsonb, $7::jsonb, $8, $9, false, $10, true)
             RETURNING *`,
            [...params, fulfillmentProvider]
            );

        const localProduct = upsert.rows[0];
        await client.query(
          'UPDATE product_variants SET active = false, updated_at = NOW() WHERE product_id = $1',
          [localProduct.id]
        );
        for (const variant of product.variants || []) {
          await client.query(
            `INSERT INTO product_variants (product_id, shopify_variant_id, sku, title, price, inventory_count, active)
            VALUES ($1, $2, $3, $4, $5, $6, true)
            ON CONFLICT (shopify_variant_id) DO UPDATE
            SET product_id = EXCLUDED.product_id,
                sku = EXCLUDED.sku,
                title = EXCLUDED.title,
                price = EXCLUDED.price,
                inventory_count = EXCLUDED.inventory_count,
                active = true,
                updated_at = NOW()`,
            [
             localProduct.id,
             String(variant.id),
             variant.sku || null,
             variant.title || 'Default',
             Number(variant.price || 0),
             Math.max(Number(variant.inventory_quantity || 0), 0),
            ]
          );
        }
        return localProduct;
      });
      syncedProducts.push(syncedProduct);
    }

    return res.json({ syncedCount: syncedProducts.length, products: syncedProducts });
  } catch (error) {
    return next(error);
  }
});

router.post('/create-order', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { baseUrl, headers } = shopifyHeaders();
    const response = await fetch(`${baseUrl}/orders.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ order: req.body.order || req.body }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to create Shopify order.' });
    }

    return res.status(201).json({ shopifyOrder: data.order });
  } catch (error) {
    return next(error);
  }
});

router.get('/status', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const configured = Boolean(process.env.SHOPIFY_STORE_URL && process.env.SHOPIFY_ACCESS_TOKEN);
    const productCount = await query('SELECT COUNT(*)::int AS count FROM products WHERE shopify_product_id IS NOT NULL');
    return res.json({
      configured,
      storeUrl: process.env.SHOPIFY_STORE_URL || null,
      syncedProducts: productCount.rows[0].count,
      fulfillmentProviders: enabledFulfillmentProviders(),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

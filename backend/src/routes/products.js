const express = require('express');
const { query } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  calculateCustomizationPrice,
  toConsumerProduct,
  toFulfillmentCustomization,
  validateFulfillmentProvider,
} = require('../utils/product');

const router = express.Router();
const consumerProductColumns = [
  'id',
  'name',
  'description',
  'final_price',
  'markup_percent',
  'category',
  'print_methods',
  'available_colors',
  'customization_options',
  'inventory_count',
  'requires_signature_branding',
].join(', ');

function parseArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseObject(value) {
  return value && typeof value === 'object' ? value : {};
}

async function variantsByProduct(productIds) {
  if (!productIds.length) return new Map();
  const result = await query(
    `SELECT id, product_id, title, sku, price, inventory_count
     FROM product_variants
     WHERE product_id = ANY($1::uuid[]) AND active = true
     ORDER BY created_at`,
    [productIds]
  );
  return result.rows.reduce((variants, variant) => {
    const current = variants.get(variant.product_id) || [];
    current.push(variant);
    variants.set(variant.product_id, current);
    return variants;
  }, new Map());
}

router.get('/', async (req, res, next) => {
  try {
    const conditions = ['active = true'];
    const values = [];

    if (req.query.category) {
      conditions.push(`category = $${values.length + 1}`);
      values.push(req.query.category);
    }

    const sql = `SELECT ${consumerProductColumns} FROM products ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC`;
    const result = await query(sql, values);
    const variants = await variantsByProduct(result.rows.map((product) => product.id));
    return res.json({
      products: result.rows.map((product) => toConsumerProduct(product, variants.get(product.id) || [])),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ${consumerProductColumns} FROM products WHERE id = $1 AND active = true`,
      [req.params.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    const variants = await variantsByProduct([result.rows[0].id]);
    return res.json({ product: toConsumerProduct(result.rows[0], variants.get(result.rows[0].id) || []) });
  } catch (error) {
    return next(error);
  }
});

router.post('/', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { name, description, baseCost, markupPercent = 20, category, printMethods, availableColors, customizationOptions, shopifyProductId, printfulProductId, fulfillmentProductId, inventoryCount = 0, active = true } = req.body;
    const fulfillmentProvider = validateFulfillmentProvider(
      req.body.fulfillmentProvider || process.env.DEFAULT_FULFILLMENT_PROVIDER || 'printful'
    );

    if (!name || Number(baseCost) <= 0) {
      return res.status(400).json({ error: 'Product name and baseCost are required.' });
    }

    const result = await query(
      `INSERT INTO products (name, description, base_cost, markup_percent, category, print_methods, available_colors, customization_options, shopify_product_id, printful_product_id, inventory_count, active, fulfillment_provider, fulfillment_product_id, requires_signature_branding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        name,
        description || null,
        Number(baseCost),
        Number(markupPercent),
        category || null,
        parseArray(printMethods),
        JSON.stringify(parseArray(availableColors)),
        JSON.stringify(parseObject(customizationOptions)),
        shopifyProductId || null,
        printfulProductId || null,
        Number(inventoryCount) || 0,
        Boolean(active),
        fulfillmentProvider,
        fulfillmentProductId || printfulProductId || null,
        parseArray(printMethods).length > 0,
      ]
    );

    return res.status(201).json({ product: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const existing = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const current = existing.rows[0];
    const payload = req.body;
    const fulfillmentProvider = validateFulfillmentProvider(
      payload.fulfillmentProvider ?? current.fulfillment_provider
    );
    const result = await query(
      `UPDATE products
       SET name = $2,
           description = $3,
           base_cost = $4,
           markup_percent = $5,
           category = $6,
           print_methods = $7,
           available_colors = $8::jsonb,
           customization_options = $9::jsonb,
           shopify_product_id = $10,
           printful_product_id = $11,
           inventory_count = $12,
           active = $13,
           fulfillment_provider = $14,
           fulfillment_product_id = $15,
           requires_signature_branding = $16,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        payload.name ?? current.name,
        payload.description ?? current.description,
        Number(payload.baseCost ?? current.base_cost),
        Number(payload.markupPercent ?? current.markup_percent),
        payload.category ?? current.category,
        parseArray(payload.printMethods ?? current.print_methods),
        JSON.stringify(payload.availableColors ?? current.available_colors),
        JSON.stringify(payload.customizationOptions ?? current.customization_options),
        payload.shopifyProductId ?? current.shopify_product_id,
        payload.printfulProductId ?? current.printful_product_id,
        Number(payload.inventoryCount ?? current.inventory_count),
        payload.active ?? current.active,
        fulfillmentProvider,
        payload.fulfillmentProductId ?? current.fulfillment_product_id,
        parseArray(payload.printMethods ?? current.print_methods).length > 0,
      ]
    );

    return res.json({ product: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/customize', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT ${consumerProductColumns} FROM products WHERE id = $1 AND active = true`,
      [req.params.id]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const product = result.rows[0];
    let variant = null;
    if (req.body.variantId) {
      const variantResult = await query(
        `SELECT id, product_id, title, sku, price, inventory_count
         FROM product_variants
         WHERE id = $1 AND product_id = $2 AND active = true`,
        [req.body.variantId, product.id]
      );
      if (!variantResult.rowCount) {
        return res.status(400).json({ error: 'Selected variant is not available for this product.' });
      }
      variant = variantResult.rows[0];
    } else {
      const variantCount = await query(
        'SELECT COUNT(*)::int AS count FROM product_variants WHERE product_id = $1 AND active = true',
        [product.id]
      );
      if (variantCount.rows[0].count > 0) {
        return res.status(400).json({ error: 'A variant is required for this product.' });
      }
    }
    const pricing = calculateCustomizationPrice(product, req.body || {}, variant);

    return res.json({
      productId: product.id,
      productName: product.name,
      variantId: variant?.id || null,
      pricing,
      selectedOptions: toFulfillmentCustomization(req.body, pricing.mandatoryBranding),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

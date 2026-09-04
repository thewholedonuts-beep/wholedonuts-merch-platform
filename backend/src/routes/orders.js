const express = require('express');
const { query, withTransaction } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  calculateCustomizationPrice,
  positiveInteger,
  toFulfillmentCustomization,
} = require('../utils/product');
const {
  allowedShopifyTopics,
  isPaidOrder,
  isReversedOrder,
  mapFulfillmentStatus,
  mapOrderFulfillmentStatus,
  verifyShopifyWebhook,
  webhookKind,
} = require('../services/shopifyWebhook');
const {
  recordVerifiedShopifyConversion,
  reverseVerifiedShopifyConversion,
  rewardsEnabled,
} = require('../services/rewards');
const { approvedRewardsPrivacyNoticeVersion } = require('../config/environment');

const router = express.Router();

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('At least one order item is required.');
  }
  return items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId || null,
    quantity: positiveInteger(item.quantity),
    customization: item.customization || null,
  }));
}

async function calculateTotals(items, discountApplied) {
  let subtotal = 0;
  const normalizedItems = [];
  for (const item of items) {
    const productResult = await query(
      `SELECT id, name, final_price, markup_percent, print_methods, customization_options, requires_signature_branding
       FROM products
       WHERE id = $1 AND active = true`,
      [item.productId]
    );
    if (!productResult.rowCount) {
      throw new Error(`Active product ${item.productId} not found.`);
    }
    const product = productResult.rows[0];
    const variants = await query(
      `SELECT id, title, sku, price, inventory_count
       FROM product_variants
       WHERE product_id = $1 AND active = true`,
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
    const pricing = calculateCustomizationPrice(product, item.customization || {}, variant);
    const unitPrice = pricing.finalPrice;
    const lineTotal = unitPrice * item.quantity;
    subtotal += lineTotal;
    normalizedItems.push({
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
    items: normalizedItems,
  };
}

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { sponsorId, customerName, customerEmail, items, customizationData = {}, referralCodeUsed } = req.body;
    if (!customerName || !customerEmail) {
      return res.status(400).json({ error: 'Customer name and email are required.' });
    }

    if (sponsorId && !req.user.isOperator && sponsorId !== req.user.sponsorId) {
      return res.status(403).json({ error: 'You do not have access to create orders for this sponsor.' });
    }

    const normalizedItems = normalizeItems(items);
    let discountApplied = 0;

    if (sponsorId && rewardsEnabled()) {
      const sponsorResult = await query(
        `SELECT discount_earned
         FROM sponsors
         WHERE id = $1
           AND rewards_consent = true
           AND rewards_consent_at IS NOT NULL
           AND rewards_consent_withdrawn_at IS NULL
           AND privacy_notice_version = $2`,
        [sponsorId, approvedRewardsPrivacyNoticeVersion()]
      );
      if (sponsorResult.rowCount) {
        discountApplied = Number(sponsorResult.rows[0].discount_earned || 0);
      }
    }

    const totals = await calculateTotals(normalizedItems, discountApplied);

    const order = await withTransaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO orders (sponsor_id, shopify_order_id, printful_order_id, customer_name, customer_email, items, subtotal, discount_applied, total, customization_data, referral_code_used)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11)
         RETURNING *`,
        [
          sponsorId || null,
          req.user.isOperator ? req.body.shopifyOrderId || null : null,
          req.user.isOperator ? req.body.printfulOrderId || null : null,
          customerName,
          customerEmail.toLowerCase(),
          JSON.stringify(totals.items),
          totals.subtotal,
          discountApplied,
          totals.total,
          JSON.stringify(customizationData),
          referralCodeUsed || null,
        ]
      );

      return insertResult.rows[0];
    });

    return res.status(201).json({ order });
  } catch (error) {
    if (['required', 'not found', 'not available', 'positive integer'].some((value) => error.message.includes(value))) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (!req.user.isOperator && result.rows[0].sponsor_id !== req.user.sponsorId) {
      return res.status(403).json({ error: 'You do not have access to this order.' });
    }

    return res.json({ order: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id/status', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { fulfillmentStatus, trackingNumber } = req.body;
    const allowed = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

    if (!allowed.includes(fulfillmentStatus)) {
      return res.status(400).json({ error: 'Invalid fulfillment status.' });
    }

    const result = await query(
      `UPDATE orders
       SET fulfillment_status = CASE
             WHEN CASE $2 WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
                >= CASE fulfillment_status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
             THEN $2 ELSE fulfillment_status
           END,
           tracking_number = COALESCE($3, tracking_number),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, fulfillmentStatus, trackingNumber || null]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    return res.json({ order: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const conditions = [];
    const values = [];

    if (req.query.sponsorId) {
      conditions.push(`sponsor_id = $${conditions.length + 1}`);
      values.push(req.query.sponsorId);
    }

    if (req.query.status) {
      conditions.push(`fulfillment_status = $${conditions.length + 1}`);
      values.push(req.query.status);
    }

    if (!req.user.isOperator) {
      conditions.push(`sponsor_id = $${conditions.length + 1}`);
      values.push(req.user.sponsorId);
    }

    const sql = `SELECT * FROM orders ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY created_at DESC`;
    const result = await query(sql, values);
    return res.json({ orders: result.rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/webhook/shopify', async (req, res, next) => {
  let eventId;
  try {
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    const signature = req.get('x-shopify-hmac-sha256');
    const rawBody = req.rawBody;
    const topic = req.get('x-shopify-topic');
    const deliveryId = req.get('x-shopify-webhook-id');

    if (!secret) {
      return res.status(503).json({ error: 'Shopify webhook verification is not configured.' });
    }
    if (!Buffer.isBuffer(rawBody) || !signature || !verifyShopifyWebhook(rawBody, signature, secret)) {
      return res.status(401).json({ error: 'Invalid Shopify webhook signature.' });
    }
    if (!topic || !allowedShopifyTopics().includes(topic)) {
      return res.status(400).json({ error: 'Unsupported Shopify webhook topic.' });
    }
    if (!deliveryId) {
      return res.status(400).json({ error: 'Missing Shopify webhook delivery ID.' });
    }

    const kind = webhookKind(topic);
    if (!kind) {
      return res.status(400).json({ error: 'Unsupported Shopify webhook topic.' });
    }
    const payload = JSON.parse(rawBody.toString('utf8'));
    const retentionDays = Number(process.env.INTEGRATION_EVENT_RETENTION_DAYS || 30);
    const claimed = await query(
      `INSERT INTO integration_events (provider, delivery_id, topic, payload, status, retention_expires_at)
       VALUES ('shopify', $1, $2, $3::jsonb, 'processing', NOW() + ($4 * INTERVAL '1 day'))
       ON CONFLICT (provider, delivery_id) DO UPDATE
         SET status = 'processing',
             attempts = integration_events.attempts + 1,
             received_at = NOW(),
             error_message = NULL
       WHERE integration_events.status = 'failed'
          OR integration_events.received_at < NOW() - INTERVAL '5 minutes'
       RETURNING id`,
      [deliveryId, topic, JSON.stringify(payload), Number.isSafeInteger(retentionDays) && retentionDays > 0 ? retentionDays : 30]
    );
    if (!claimed.rowCount) {
      return res.status(200).json({ received: true, duplicate: true });
    }
    eventId = claimed.rows[0].id;

    const result = await withTransaction(async (client) => {
      if (kind === 'fulfillment') {
        const shopifyOrderId = String(payload.order_id || '');
        if (!shopifyOrderId) {
          const error = new Error('Shopify fulfillment payload is missing order_id.');
          error.statusCode = 400;
          throw error;
        }
        const update = await client.query(
          `UPDATE orders
           SET fulfillment_status = CASE
                 WHEN CASE $2 WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
                    >= CASE fulfillment_status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
                 THEN $2 ELSE fulfillment_status
               END,
               tracking_number = COALESCE($3, tracking_number),
               updated_at = NOW()
           WHERE shopify_order_id = $1
           RETURNING *`,
          [
            shopifyOrderId,
            mapFulfillmentStatus(payload.status),
            payload.tracking_number || payload.tracking_numbers?.[0] || null,
          ]
        );
        if (!update.rowCount) {
          await client.query(
            `INSERT INTO pending_shopify_fulfillments
               (shopify_order_id, fulfillment_status, tracking_number, retention_expires_at)
             VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 day'))
             ON CONFLICT (shopify_order_id) DO UPDATE
             SET fulfillment_status = CASE
                   WHEN CASE EXCLUDED.fulfillment_status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
                      >= CASE pending_shopify_fulfillments.fulfillment_status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
                   THEN EXCLUDED.fulfillment_status ELSE pending_shopify_fulfillments.fulfillment_status
                 END,
                 tracking_number = COALESCE(EXCLUDED.tracking_number, pending_shopify_fulfillments.tracking_number),
                 received_at = NOW(),
                 retention_expires_at = EXCLUDED.retention_expires_at`,
            [
              shopifyOrderId,
              mapFulfillmentStatus(payload.status),
              payload.tracking_number || payload.tracking_numbers?.[0] || null,
              Number.isSafeInteger(retentionDays) && retentionDays > 0 ? retentionDays : 30,
            ]
          );
        }
        await client.query('UPDATE integration_events SET status = $2, processed_at = NOW() WHERE id = $1', [eventId, 'processed']);
        return { order: update.rows[0] || null, synced: Boolean(update.rowCount), kind };
      }

      const shopifyOrderId = String(payload.id);
      const referralCode = payload.note_attributes?.find?.((attribute) => attribute.name === 'referral_code')?.value || null;
      const subtotal = Number(payload.subtotal_price || payload.current_subtotal_price || 0);
      const total = Number(payload.total_price || subtotal);
      const orderResult = await client.query(
        `INSERT INTO orders
           (shopify_order_id, customer_name, customer_email, items, subtotal, total, customization_data, fulfillment_status, tracking_number, referral_code_used)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8, $9, $10)
         ON CONFLICT (shopify_order_id) DO UPDATE
         SET customer_name = EXCLUDED.customer_name,
             customer_email = EXCLUDED.customer_email,
             items = EXCLUDED.items,
             subtotal = EXCLUDED.subtotal,
             total = EXCLUDED.total,
             customization_data = EXCLUDED.customization_data,
             fulfillment_status = CASE
               WHEN CASE EXCLUDED.fulfillment_status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
                  >= CASE orders.fulfillment_status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
               THEN EXCLUDED.fulfillment_status ELSE orders.fulfillment_status
             END,
             tracking_number = COALESCE(EXCLUDED.tracking_number, orders.tracking_number),
             referral_code_used = EXCLUDED.referral_code_used,
             updated_at = NOW()
         RETURNING *`,
        [
          shopifyOrderId,
          [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(' ') || payload.contact_email || 'Shopify Customer',
          String(payload.email || payload.contact_email || 'unknown@example.com').toLowerCase(),
          JSON.stringify((payload.line_items || []).map((item) => ({
            shopifyProductId: item.product_id ? String(item.product_id) : null,
            shopifyVariantId: item.variant_id ? String(item.variant_id) : null,
            sku: item.sku || null,
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.price || 0),
          }))),
          subtotal,
          total,
          JSON.stringify({ source: 'shopify-webhook', tags: payload.tags }),
          mapOrderFulfillmentStatus(payload.fulfillment_status),
          payload.fulfillments?.[0]?.tracking_number || null,
          referralCode,
        ]
      );
      const pendingFulfillment = await client.query(
        `DELETE FROM pending_shopify_fulfillments
         WHERE shopify_order_id = $1
         RETURNING fulfillment_status, tracking_number`,
        [shopifyOrderId]
      );
      if (pendingFulfillment.rowCount) {
        const pending = pendingFulfillment.rows[0];
        const updatedOrder = await client.query(
          `UPDATE orders
           SET fulfillment_status = CASE
                 WHEN CASE $2 WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
                    >= CASE fulfillment_status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END
                 THEN $2 ELSE fulfillment_status
               END,
               tracking_number = COALESCE($3, tracking_number),
               updated_at = NOW()
           WHERE shopify_order_id = $1
           RETURNING *`,
          [shopifyOrderId, pending.fulfillment_status, pending.tracking_number]
        );
        orderResult.rows[0] = updatedOrder.rows[0];
      }

      let reward = null;
      if (isReversedOrder(payload)) {
        reward = await reverseVerifiedShopifyConversion(client, shopifyOrderId);
      } else if (isPaidOrder(payload)) {
        reward = await recordVerifiedShopifyConversion(client, {
          code: referralCode,
          orderId: shopifyOrderId,
        });
        if (reward?.sponsorId) {
          await client.query('UPDATE orders SET sponsor_id = $2 WHERE shopify_order_id = $1', [
            shopifyOrderId,
            reward.sponsorId,
          ]);
          orderResult.rows[0].sponsor_id = reward.sponsorId;
        }
      }
      await client.query('UPDATE integration_events SET status = $2, processed_at = NOW() WHERE id = $1', [eventId, 'processed']);
      return {
        order: orderResult.rows[0],
        synced: true,
        kind,
        rewardChanged: Boolean(reward && !reward.duplicate),
      };
    });
    return res.status(kind === 'order' ? 201 : 200).json(result);
  } catch (error) {
    if (eventId) {
      await query(
        'UPDATE integration_events SET status = $2, error_message = $3 WHERE id = $1',
        [eventId, 'failed', error.message.slice(0, 1000)]
      ).catch((updateError) => console.error('Failed to record Shopify webhook error', updateError));
    }
    return next(error);
  }
});

module.exports = router;

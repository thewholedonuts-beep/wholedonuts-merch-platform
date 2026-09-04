const express = require('express');
const { query } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { enabledFulfillmentProviders, getFulfillmentAdapter } = require('../services/fulfillment');

const router = express.Router();

function requireEnabledProvider(req, res, next) {
  try {
    if (!enabledFulfillmentProviders().includes(req.params.provider)) {
      return res.status(404).json({ error: 'Fulfillment provider is not enabled.' });
    }
    req.fulfillmentAdapter = getFulfillmentAdapter(req.params.provider);
    return next();
  } catch (error) {
    error.statusCode = 400;
    return next(error);
  }
}

router.use(authenticateToken, requireAdmin);

router.get('/:provider/status', requireEnabledProvider, async (req, res, next) => {
  try {
    const status = await req.fulfillmentAdapter.getStatus();
    return res.json({ provider: req.params.provider, configured: true, ...status });
  } catch (error) {
    return next(error);
  }
});

router.post('/:provider/reconcile-catalog', requireEnabledProvider, async (req, res, next) => {
  try {
    const remoteProducts = await req.fulfillmentAdapter.listCatalog();
    const localProducts = await query(
      `SELECT id, name, fulfillment_product_id
       FROM products
       WHERE fulfillment_provider = $1`,
      [req.params.provider]
    );
    const localByProviderId = new Map(
      localProducts.rows
        .filter((product) => product.fulfillment_product_id)
        .map((product) => [String(product.fulfillment_product_id), product])
    );

    return res.json({
      provider: req.params.provider,
      remoteCount: remoteProducts.length,
      mapped: remoteProducts
        .filter((product) => localByProviderId.has(product.providerProductId))
        .map((product) => ({
          ...product,
          localProductId: localByProviderId.get(product.providerProductId).id,
        })),
      unmapped: remoteProducts.filter((product) => !localByProviderId.has(product.providerProductId)),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

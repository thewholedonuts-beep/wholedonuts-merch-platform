const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { getFulfillmentAdapter } = require('../services/fulfillment');

const router = express.Router();

router.get('/status', authenticateToken, requireAdmin, async (_req, res, next) => {
  try {
    const data = await getFulfillmentAdapter('printful').getStatus();
    return res.json({
      configured: true,
      ...data,
      storeId: data.accountId,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

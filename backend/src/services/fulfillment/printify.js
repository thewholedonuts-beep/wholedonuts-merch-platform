const { requestJson } = require('./request');

function config() {
  if (!process.env.PRINTIFY_API_KEY || !process.env.PRINTIFY_SHOP_ID) {
    throw new Error('Printify credentials are not configured.');
  }
  return {
    baseUrl: process.env.PRINTIFY_API_BASE_URL || 'https://api.printify.com',
    shopId: process.env.PRINTIFY_SHOP_ID,
    headers: {
      Authorization: `Bearer ${process.env.PRINTIFY_API_KEY}`,
    },
  };
}

async function getStatus() {
  const { baseUrl, headers, shopId } = config();
  const shops = await requestJson(`${baseUrl}/v1/shops.json`, { headers });
  const shop = (shops || []).find((candidate) => String(candidate.id) === String(shopId));
  if (!shop) {
    throw new Error('Configured Printify shop was not found for this token.');
  }
  return {
    connected: true,
    accountId: String(shop.id),
    accountName: shop.title || null,
  };
}

async function listCatalog() {
  const { baseUrl, headers, shopId } = config();
  const data = await requestJson(`${baseUrl}/v1/shops/${encodeURIComponent(shopId)}/products.json`, { headers });
  return (data?.data || []).map((product) => ({
    providerProductId: String(product.id),
    title: product.title,
    variantIds: (product.variants || []).map((variant) => String(variant.id)),
  }));
}

module.exports = {
  getStatus,
  listCatalog,
};

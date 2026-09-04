const { requestJson } = require('./request');

function config() {
  if (!process.env.PRINTFUL_API_KEY || !process.env.PRINTFUL_STORE_ID) {
    throw new Error('Printful credentials are not configured.');
  }
  return {
    baseUrl: process.env.PRINTFUL_API_BASE_URL || 'https://api.printful.com',
    headers: {
      Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
      'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID,
    },
  };
}

async function getStatus() {
  const { baseUrl, headers } = config();
  const data = await requestJson(`${baseUrl}/store`, { headers });
  return {
    connected: true,
    accountId: data?.result?.id ? String(data.result.id) : null,
    accountName: data?.result?.name || null,
  };
}

async function listCatalog() {
  const { baseUrl, headers } = config();
  const data = await requestJson(`${baseUrl}/store/products?limit=100`, { headers });
  return (data?.result || []).map((product) => ({
    providerProductId: String(product.id),
    title: product.name,
    variantIds: [],
  }));
}

module.exports = {
  getStatus,
  listCatalog,
};

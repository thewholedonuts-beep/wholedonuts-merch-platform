const printful = require('./printful');
const printify = require('./printify');
const { fulfillmentProviders } = require('../../config/environment');
const { validateFulfillmentProvider } = require('../../utils/product');

/**
 * @typedef {Object} FulfillmentAdapter
 * @property {() => Promise<{connected: boolean, accountId: string|null, accountName: string|null}>} getStatus
 * @property {() => Promise<Array<{providerProductId: string, title: string, variantIds: string[]}>>} listCatalog
 */

/** @type {Record<'printful'|'printify', FulfillmentAdapter>} */
const adapters = {
  printful,
  printify,
};

function getFulfillmentAdapter(provider) {
  return adapters[validateFulfillmentProvider(provider)];
}

function enabledFulfillmentProviders() {
  return fulfillmentProviders().map(validateFulfillmentProvider);
}

module.exports = {
  enabledFulfillmentProviders,
  getFulfillmentAdapter,
};

const fs = require('fs/promises');
const path = require('path');
const {
  fulfillmentProviders,
  shopifyWebhookTopics,
  validateProductionEnvironment,
} = require('../config/environment');
const { pool } = require('../config/database');

const REPORT_PATH = path.resolve(process.cwd(), process.env.LAUNCH_REPORT_PATH || 'launch-readiness.json');
const TOPIC_NAMES = {
  'orders/create': 'ORDERS_CREATE',
  'orders/updated': 'ORDERS_UPDATED',
  'fulfillments/create': 'FULFILLMENTS_CREATE',
  'fulfillments/update': 'FULFILLMENTS_UPDATE',
};

function webhookCallbackUrl(publicApiUrl) {
  return `${publicApiUrl.replace(/\/$/, '')}/api/orders/webhook/shopify`;
}

function evaluateMappings(rows, printfulProducts) {
  const errors = [];
  if (!rows.length) return ['No active products are configured for launch.'];

  const products = new Map();
  for (const row of rows) {
    if (!products.has(row.product_id)) {
      products.set(row.product_id, {
        ...row,
        variants: [],
      });
    }
    if (row.variant_id) products.get(row.product_id).variants.push(row);
  }

  for (const product of products.values()) {
    const label = `Product ${product.product_id}`;
    if (product.fulfillment_provider !== 'printful') {
      errors.push(`${label} is assigned to ${product.fulfillment_provider}, not printful.`);
    }
    if (!product.shopify_product_id || !product.fulfillment_product_id) {
      errors.push(`${label} is missing its Shopify or Printful product mapping.`);
    }
    if (
      !product.requires_signature_branding
      || product.signature_text !== 'Made By +U, 4 ALL'
      || product.signature_placement !== 'left-side-or-sleeve'
    ) {
      errors.push(`${label} does not have the mandatory Made By +U, 4 ALL branding configuration.`);
    }
    if (!product.variants.length) {
      errors.push(`${label} has no active variants.`);
      continue;
    }

    const remote = printfulProducts.get(String(product.fulfillment_product_id));
    if (!remote) {
      errors.push(`${label} references a Printful sync product that was not found.`);
      continue;
    }
    if (String(remote.syncProduct.external_id || '') !== String(product.shopify_product_id)) {
      errors.push(`${label} does not match the Shopify product linked by Printful.`);
    }

    const remoteBySyncId = new Map(
      remote.syncVariants.map((variant) => [String(variant.id), variant])
    );
    for (const variant of product.variants) {
      if (!variant.shopify_variant_id || !variant.fulfillment_variant_id) {
        errors.push(`Variant ${variant.variant_id} is missing its Shopify or Printful mapping.`);
        continue;
      }
      const remoteVariant = remoteBySyncId.get(String(variant.fulfillment_variant_id));
      if (
        String(remoteVariant?.external_id || '') !== String(variant.shopify_variant_id)
        || remoteVariant?.synced !== true
      ) {
        errors.push(`Variant ${variant.variant_id} does not match the Shopify variant linked by Printful.`);
      }
    }
  }

  return errors;
}

async function fetchJson(url, options, provider) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${provider} request failed with status ${response.status}.`);
  }
  return response.json();
}

async function shopifyGraphql(query, variables = {}) {
  const url = `https://${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`;
  const payload = await fetchJson(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  }, 'Shopify');
  if (payload.errors?.length) {
    throw new Error(`Shopify GraphQL request failed: ${payload.errors.map((error) => error.message).join('; ')}`);
  }
  return payload.data;
}

async function verifyShopifyConnection() {
  const data = await shopifyGraphql('{ shop { id } }');
  if (!data?.shop?.id) throw new Error('Shopify did not return the configured shop.');
}

async function ensureShopifyWebhooks(mode) {
  const callbackUrl = webhookCallbackUrl(process.env.PUBLIC_API_URL);
  const topics = shopifyWebhookTopics();
  const subscriptions = [];
  let cursor = null;
  do {
    const existing = await shopifyGraphql(
      `query LaunchWebhookSubscriptions($after: String) {
        webhookSubscriptions(first: 100, after: $after) {
          nodes { id topic uri format filter includeFields }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after: cursor }
    );
    subscriptions.push(...existing.webhookSubscriptions.nodes);
    cursor = existing.webhookSubscriptions.pageInfo.hasNextPage
      ? existing.webhookSubscriptions.pageInfo.endCursor
      : null;
  } while (cursor);

  for (const topic of topics) {
    const graphqlTopic = TOPIC_NAMES[topic];
    if (subscriptions.some((subscription) => (
      subscription.topic === graphqlTopic
      && subscription.uri === callbackUrl
      && subscription.format === 'JSON'
      && !subscription.filter
      && (!subscription.includeFields || subscription.includeFields.length === 0)
    ))) {
      continue;
    }
    if (mode !== 'launch') {
      throw new Error(`Missing Shopify ${topic} webhook for the production callback.`);
    }
    const created = await shopifyGraphql(
      `mutation LaunchWebhookSubscription(
        $topic: WebhookSubscriptionTopic!,
        $subscription: WebhookSubscriptionInput!
      ) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $subscription) {
          webhookSubscription { id }
          userErrors { message }
        }
      }`,
      {
        topic: graphqlTopic,
        subscription: { uri: callbackUrl, format: 'JSON' },
      }
    );
    const result = created.webhookSubscriptionCreate;
    if (result.userErrors.length || !result.webhookSubscription?.id) {
      throw new Error(`Shopify rejected the ${topic} webhook: ${result.userErrors.map((error) => error.message).join('; ')}`);
    }
  }
}

function printfulHeaders() {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
    'X-PF-Store-Id': process.env.PRINTFUL_STORE_ID,
  };
}

async function loadPrintfulProducts() {
  const baseUrl = process.env.PRINTFUL_API_BASE_URL || 'https://api.printful.com';
  const store = await fetchJson(`${baseUrl}/store`, { headers: printfulHeaders() }, 'Printful');
  if (!store?.result?.id || String(store.result.id) !== String(process.env.PRINTFUL_STORE_ID)) {
    throw new Error('Printful token did not resolve to PRINTFUL_STORE_ID.');
  }
  const catalog = await fetchJson(`${baseUrl}/store/products?limit=100`, { headers: printfulHeaders() }, 'Printful');
  const products = new Map();
  const catalogItems = [...(catalog.result || [])];
  let offset = catalogItems.length;
  while (
    catalogItems.length > 0
    && catalogItems.length < Number(catalog.paging?.total || catalogItems.length)
  ) {
    const page = await fetchJson(
      `${baseUrl}/store/products?limit=100&offset=${offset}`,
      { headers: printfulHeaders() },
      'Printful'
    );
    const items = page.result || [];
    catalogItems.push(...items);
    offset += items.length;
    if (!items.length) break;
  }
  for (const item of catalogItems) {
    const detail = await fetchJson(
      `${baseUrl}/store/products/${encodeURIComponent(item.id)}`,
      { headers: printfulHeaders() },
      'Printful'
    );
    if (detail?.result?.sync_product) {
      products.set(String(item.id), {
        syncProduct: detail.result.sync_product,
        syncVariants: detail.result.sync_variants || [],
      });
    }
  }
  return products;
}

async function verifyDatabaseAndMappings(printfulProducts) {
  const migrationsDirectory = path.resolve(__dirname, '../../../database/migrations');
  const expectedMigrations = (await fs.readdir(migrationsDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  const applied = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  const appliedNames = new Set(applied.rows.map((row) => row.name));
  const pending = expectedMigrations.filter((name) => !appliedNames.has(name));
  if (pending.length) {
    throw new Error(`Pending database migrations: ${pending.join(', ')}`);
  }

  const mappings = await pool.query(
    `SELECT p.id AS product_id,
            p.shopify_product_id,
            p.fulfillment_provider,
            p.fulfillment_product_id,
            p.requires_signature_branding,
            p.signature_text,
            p.signature_placement,
            v.id AS variant_id,
            v.shopify_variant_id,
            v.fulfillment_variant_id
     FROM products p
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.active = true
     WHERE p.active = true
     ORDER BY p.id, v.id`
  );
  const errors = evaluateMappings(mappings.rows, printfulProducts);
  if (errors.length) throw new Error(errors.join(' '));
}

async function run() {
  const mode = process.env.LAUNCH_MODE === 'launch' ? 'launch' : 'readiness';
  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    provider: 'printful',
    ready: false,
    checks: [],
  };

  async function check(name, work) {
    try {
      const result = await work();
      report.checks.push({ name, status: 'passed' });
      console.log(`PASS: ${name}`);
      return result;
    } catch (error) {
      report.checks.push({ name, status: 'failed', message: error.message });
      console.error(`FAIL: ${name}: ${error.message}`);
      throw error;
    }
  }

  try {
    await check('Production configuration', async () => {
      validateProductionEnvironment();
      if (fulfillmentProviders().join(',') !== 'printful') {
        throw new Error('Launch requires FULFILLMENT_PROVIDERS=printful.');
      }
    });
    await check('Shopify connectivity', verifyShopifyConnection);
    const printfulProducts = await check('Printful connectivity and catalog', loadPrintfulProducts);
    await check('Database migrations and product mappings', () => verifyDatabaseAndMappings(printfulProducts));
    await check('Shopify webhook subscriptions', () => ensureShopifyWebhooks(mode));
    report.ready = true;
  } catch {
    process.exitCode = 1;
  } finally {
    await pool.end();
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const lines = [
        '# Shopify + Printful launch readiness',
        '',
        `**Result:** ${report.ready ? 'READY' : 'BLOCKED'}`,
        `**Mode:** ${mode}`,
        '',
        '| Check | Status |',
        '|---|---|',
        ...report.checks.map((item) => `| ${item.name} | ${item.status.toUpperCase()} |`),
        '',
        report.ready
          ? (mode === 'launch'
            ? 'All automated launch gates passed and required Shopify webhooks are registered.'
            : 'All readiness gates passed; no external configuration was changed.')
          : 'Launch is blocked. Review the failed workflow step and the report artifact; no success has been claimed.',
      ];
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Launch readiness report failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  evaluateMappings,
  webhookCallbackUrl,
};

# Fulfillment provider setup

Shopify remains the public checkout and order system of record. Printful and Printify are server-side fulfillment providers selected per product; neither provider token belongs in the browser or the public site.

## Credentials

Set `FULFILLMENT_PROVIDERS=printful,printify` to enable both adapters and choose the initial import assignment with `DEFAULT_FULFILLMENT_PROVIDER`.

- Printful: create a least-privilege private token with store and product read access. Set `PRINTFUL_API_KEY`; optionally override `PRINTFUL_API_BASE_URL`.
- Printify: create a personal access token with shop and catalog read access, identify the target shop, and set `PRINTIFY_API_KEY` plus `PRINTIFY_SHOP_ID`; optionally override `PRINTIFY_API_BASE_URL`.

All values are API runtime secrets except the non-secret provider names. Never use `NEXT_PUBLIC_*` variables for provider credentials.

## Operator checks

With the API deployed and an operator credential:

1. Call `GET /api/fulfillment/printful/status` and `GET /api/fulfillment/printify/status`.
2. Call `POST /api/fulfillment/{provider}/reconcile-catalog` for each enabled provider.
3. Review unmapped products and set `fulfillment_provider` plus `fulfillment_product_id` for every active local product. Existing `printful_product_id` values are migrated into the neutral mapping field.
4. Confirm every Shopify variant maps to an enabled provider variant in the provider dashboard. The API records Shopify variants but intentionally does not guess cross-provider variant mappings.
5. Place a paid staging Shopify order for each provider and confirm fulfillment status returns through Shopify.

The reconciliation endpoints are read-only foundations; they do not publish products, submit fulfillment orders, or mutate provider catalogs. Those workflows require separate approval and provider-specific idempotency handling.

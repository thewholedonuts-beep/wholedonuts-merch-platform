# Fulfillment provider setup

Shopify remains the public checkout and order system of record. Printful is the only launch provider; neither its token nor any future provider token belongs in the browser or public site. Follow the authoritative [Shopify + Printful launch runbook](SHOPIFY_PRINTFUL_LAUNCH.md).

## Credentials

For launch, set `FULFILLMENT_PROVIDERS=printful` and `DEFAULT_FULFILLMENT_PROVIDER=printful`.

- Printful: create a least-privilege private token with store and sync-product read access. Set `PRINTFUL_API_KEY` and `PRINTFUL_STORE_ID`; optionally override `PRINTFUL_API_BASE_URL`.
- Future Printify review only: the adapter remains isolated behind the provider registry. Enabling it in production requires credentials, mapping/order tests, owner approval, and the explicit `ALLOW_PRINTIFY_FULFILLMENT=true` gate.

All values are API runtime secrets except the non-secret provider names. Never use `NEXT_PUBLIC_*` variables for provider credentials.

## Operator checks

With the API deployed and an operator credential:

1. Call `GET /api/fulfillment/printful/status`.
2. Call `POST /api/fulfillment/printful/reconcile-catalog`.
3. Review unmapped products and set `fulfillment_provider` plus `fulfillment_product_id` for every active local product. Existing `printful_product_id` values are migrated into the neutral mapping field.
4. Confirm every Shopify variant maps to an enabled provider variant in the provider dashboard. The API records Shopify variants but intentionally does not guess cross-provider variant mappings.
5. Place one paid test Shopify order and confirm Printful fulfillment status returns through Shopify.

The reconciliation endpoints are read-only foundations; they do not publish products, submit fulfillment orders, or mutate provider catalogs. Those workflows require separate approval and provider-specific idempotency handling.

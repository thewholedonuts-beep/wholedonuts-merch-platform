# Launch reconciliation

**Status:** owner review required; no public merchandising destination is verified by this repository.

Whole Donuts is an LLC, not a nonprofit. If the public site later describes support, use the exact concept **voluntary support to Whole Donuts LLC** and state that it is not tax-deductible, not a purchase, not an investment, and does not automatically earn rewards. Contributions can also be time, a skill, encouragement, sharing, or simply showing up; do not rank people by financial amount.

## Safe inclusion after owner confirmation

The only candidate public representation is a single external link in the canonical site's [Goods Window](https://wenevergonnaclose.com/#table) to an owner-confirmed HTTPS destination. Its published storefront configuration is currently blank, and no deployment record in this repository identifies a production destination. Before adding that link, confirm the destination, catalog/design rights, Shopify checkout, Printful fulfillment mappings, customer support terms, and accessibility. The dashboard itself is invitation-only and should not be presented as a public store.

## Excluded from the canonical site

- Placeholder hosts such as `merch.example.com` and `merch-api.example.com`; they are documentation examples, not destinations. The external URLs currently shown in the canonical site's `#awd` and `#tnc` sections also return to canonical-site sections, not a merchant storefront.
- Dashboard routes, API health/readiness probes, Shopify webhooks, and operator integration-status routes; these are operational surfaces, not public offerings.
- Referral codes and analytics. The related routes are disabled by default because they can process hashed IP addresses and referral metadata. Enable them only after owner approval of purpose, notice, retention, and access controls.
- Inactive or automatically imported catalog data, customization previews, pricing assumptions, sponsor records, order data, credentials, and integration configuration. This repository contains no owner-approved public catalog, rights confirmation, or production deployment record.

## Required owner decisions

1. Confirm the exact public HTTPS store or portal URL and who operates it.
2. Approve each product/design, pricing, fulfillment mapping, and customer-facing policy before activation.
3. Decide whether sponsor self-registration or referral analytics is allowed. Both are disabled by default; referral analytics requires an approved privacy review before enabling.
4. Keep API routes, secrets, order/sponsor data, and provider credentials outside public navigation and source content.

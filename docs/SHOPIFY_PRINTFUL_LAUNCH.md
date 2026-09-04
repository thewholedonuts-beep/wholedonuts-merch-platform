# Shopify + Printful production launch

**Current status:** this repository is launch automation, not proof of a live store. No Shopify
store, Printful store, hosting service, database, domain, product mapping, payment method, tax
registration, or credential is created or confirmed here.

Shopify is the checkout and order system of record. The official Printful Shopify app imports
orders, charges the owner for production and shipping, fulfills mapped items, and returns tracking
to Shopify. The Whole Donuts API verifies Shopify lifecycle webhooks and keeps the private
operational record. Printful is the only launch provider. The dormant Printify adapter remains
available for a future separately reviewed migration; it is not enabled by the launch workflow.

## 1. Create and connect the owner accounts

1. Create or select the owner-controlled Shopify store, finish Shopify identity and payment setup,
   choose the markets that may check out, and keep the storefront password-protected until every
   check below passes.
2. Create or select the owner-controlled Printful account. In Shopify Admin, install the official
   **Printful: Print on Demand** app, sign in to Printful through the embedded app, and confirm the
   intended Printful store appears. Do not use the repository's custom app in place of the official
   Printful app; the Printful app is what imports and fulfills Shopify orders.
3. In Printful, configure an owner-controlled card, PayPal account, or funded Wallet. A Shopify
   customer payment does not pay Printful automatically; Printful charges the owner separately.
4. In Shopify, create the private custom app used by this API. Grant `read_products`,
   `read_inventory`, and `read_orders`. Do not grant `write_orders` unless the owner explicitly
   approves the operator-only `POST /api/shopify/create-order` workflow. Install the app and retain
   its Admin API access token and client secret once in a password manager.
5. In Printful **Developers/API tokens**, create a private token limited to the selected store with
   read access to store information and sync products. Record the numeric Printful store ID shown
   for that store. The launch automation only reads `/store` and `/store/products`; it does not
   submit fulfillment orders.

## 2. Provision hosting and the protected GitHub environment

Provision the API, dashboard, and private PostgreSQL service described in
[the deployment guide](DEPLOYMENT.md). The API must have a stable public HTTPS origin and the
PostgreSQL endpoint must be reachable from GitHub-hosted runners if the workflow will apply
migrations. If the database is private to the hosting network, run `npm run migrate` as the host's
one-off release command, confirm no migrations remain, and dispatch with **Apply migrations**
disabled.

Create a GitHub Actions environment named `production`. Add required reviewers, restrict deployment
branches to `main`, and enter these values:

| Type | Name | Exact source |
|---|---|---|
| Secret | `DATABASE_URL` | Managed PostgreSQL TLS connection string |
| Secret | `DATABASE_SSL_CA` | Provider CA PEM when required; otherwise leave unset |
| Secret | `JWT_SECRET` | Unique random value, at least 32 characters |
| Secret | `OPERATOR_API_KEY` | Different unique random value, at least 32 characters |
| Secret | `RATE_LIMIT_KEY_SALT` | Third unique random value, at least 32 characters |
| Secret | `SHOPIFY_ACCESS_TOKEN` | Installed custom app Admin API access token |
| Secret | `SHOPIFY_WEBHOOK_SECRET` | That custom app's client/webhook signing secret |
| Secret | `PRINTFUL_API_KEY` | Store-limited Printful private token |
| Variable | `FRONTEND_URLS` | Exact comma-separated HTTPS dashboard origins |
| Variable | `PUBLIC_API_URL` | API HTTPS origin only, with no path |
| Variable | `SHOPIFY_STORE_URL` | `*.myshopify.com` hostname only |
| Variable | `SHOPIFY_API_VERSION` | Supported stable `YYYY-MM` version, currently `2026-07` |
| Variable | `PRINTFUL_STORE_ID` | Numeric ID of the connected Printful store |

Put the same runtime settings in the hosting provider secret/config store. Also set
`NODE_ENV=production`, `FULFILLMENT_PROVIDERS=printful`,
`DEFAULT_FULFILLMENT_PROVIDER=printful`, and
`SHOPIFY_WEBHOOK_TOPICS=orders/create,orders/updated,fulfillments/create,fulfillments/update`.
Keep self-registration, analytics, and rewards disabled unless their existing owner/privacy gates
have separately been satisfied. Never put a credential in `NEXT_PUBLIC_*`, workflow inputs, logs,
repository variables, or committed files.

### Shared-network and abuse controls

Do not enforce one email or account per IP address. Households, schools, libraries, workplaces,
carrier NAT, VPNs, and IPv6 rotation make that rule both inaccurate and easy to evade. The API
instead layers short-lived in-memory limits per normalized account/email identifier and per IP
range for registration, login, checkout, referral, consent, reward-identity, and trusted acceptance
actions. Account/email keys are HMACed with `RATE_LIMIT_KEY_SALT`; raw email addresses are not rate
limit keys, and the application does not persist raw IP addresses for these controls. Public
referral-code limits use an HMAC of code plus normalized IP range, so one client or popular code
cannot consume a global code-wide quota. Referral
analytics, when separately enabled, uses the existing keyed IP hash and approved retention policy.

The default limits deliberately permit multiple legitimate people on one network. Do not lower
them to one account or email per IP. Suspicious bursts, repeated account churn, credential stuffing,
and reward/referral anomalies should trigger an edge challenge or operator review, not an automatic
permanent household/network ban. No invasive device fingerprinting is authorized.

Configure the production edge/WAF to rate-limit the Shopify webhook callback by burst while still
allowing Shopify retries, preserve the original request body and Shopify headers, and challenge
public account/login bursts before they reach the API. The app does not throttle the webhook route
because dropping authenticated provider retries can lose lifecycle updates; HMAC verification,
topic allowlisting, delivery-ID idempotency, and edge controls protect that callback. Set a short
edge log retention period, redact query/body credentials and email addresses, restrict log access,
and include IP/rate-limit use in the approved privacy notice. Public self-registration must remain
disabled until the owner supplies verified-email delivery, challenge/escalation, support, and
privacy processes; the repository does not claim those external controls exist.

## 3. Map and approve the catalog

1. Build each item in Printful and include the non-removable `Made By +U, 4 ALL` mark at the
   left side or sleeve in every production design file. Publish/sync the selected colors and sizes
   to Shopify from Printful. Do not activate an item in this API merely because it was imported.
2. Run the operator-only `POST /api/shopify/sync-products`. Imported products remain inactive and
   retain server-authoritative pricing, inventory, privacy, and reward controls.
3. Run `POST /api/fulfillment/printful/reconcile-catalog`. For each product, compare the local
   Shopify product/variant IDs with Printful's sync product ID and sync variant IDs. Do not use
   catalog product/variant IDs; the mapping requires the IDs returned by `/store/products`.
4. Save the complete mapping atomically with
   `PUT /api/products/<local-product-id>/fulfillment-mapping`:

   ```json
   {
     "fulfillmentProductId": "PRINTFUL_SYNC_PRODUCT_ID",
     "variants": [
       {
         "variantId": "LOCAL_PRODUCT_VARIANT_UUID",
         "fulfillmentVariantId": "PRINTFUL_SYNC_VARIANT_ID",
         "brandingFileId": "PRINTFUL_FILE_ID",
         "brandingPlacement": "sleeve_left"
       }
     ]
   }
   ```

   Supply exactly one entry for every active local variant. Before recording `brandingFileId`,
   visually inspect that exact remote Printful file and final mockup and confirm it contains the
   required `Made By +U, 4 ALL` artwork at `brandingPlacement`. The workflow resolves the mapped
   sync variant from Printful and requires that same remote file ID and placement to remain attached;
   local branding metadata alone cannot pass. It rejects missing, unsynced, mismatched, non-Printful,
   or fabricated mappings.
5. Have the owner approve the final mockup, rights, retail price, margin, SKU, size/color set, and
   the mandatory signature. Then activate only the approved local products.

## 4. Shipping, tax, returns, and notifications

Before opening checkout, record the owner's decision for each item and market:

- **Shipping:** use Printful's automatically created flat-rate profiles, free shipping priced into
  the retail price, or eligible Printful live rates. Review multi-item and mixed-cart totals;
  Shopify flat profiles can undercharge additional items in the same profile. Confirm every enabled
  market has a valid Printful shipping rate and delivery estimate.
- **Tax:** the owner or tax professional must configure Shopify registrations, product tax
  categories, collection regions, and tax-inclusive pricing where required, and separately complete
  Printful billing/tax details and resale certificates. A successful API check is not tax advice or
  evidence of registration.
- **Returns:** publish an owner-approved Shopify refund/return policy and support contact. Align it
  with Printful's current policy for damaged, mislabeled, defective, and lost orders, while stating
  who handles buyer's-remorse, wrong-size, address, and unclaimed returns. Whole Donuts remains the
  merchant responsible to the customer.
- **Notifications:** review Shopify order, shipping, cancellation, and refund templates. Confirm
  they identify Whole Donuts, use the approved support address, and do not describe voluntary
  support as tax-deductible, a purchase, an investment, or an automatic reward.

## 5. Run the push-button gate

From **Actions → Launch Shopify + Printful → Run workflow**:

1. Select `readiness`, disable migrations, enter `READINESS`, and run. This performs no external
   writes and intentionally reports **BLOCKED** until all four webhook subscriptions already exist.
2. Resolve every reported prerequisite. For the production run, select `launch`, leave migrations
   enabled only when the runner can safely reach PostgreSQL, enter `LAUNCH`, and approve the
   protected environment deployment.
3. The workflow validates required settings without printing their values, runs targeted backend
   tests and the frontend production build, optionally invokes the existing forward-only migration
   runner, verifies Shopify and Printful connectivity, verifies every active product and variant
   mapping plus its owner-approved remote Printful branding file/placement, and sends invalid- then
   valid-signature deliberately unsupported readiness payloads to the deployed callback. Both are
   rejected before parsing or database/business-event processing; the expected `401` then `400`
   responses prove the public receiver enforces HMAC and uses the same `SHOPIFY_WEBHOOK_SECRET`.
   The workflow then
   idempotently creates only missing required Shopify webhook subscriptions at:

   ```text
   https://<api-origin>/api/orders/webhook/shopify
   ```

4. Download `shopify-printful-readiness-report` in readiness mode or
   `shopify-printful-launch-report` in launch mode, and require the job summary to say **READY**.
   A missing host, database, credential, API authorization, catalog, mapping, or webhook causes a
   nonzero job and **BLOCKED** report.

## 6. Paid test-order checklist

Keep the storefront private and place one real low-cost order to a deliverable address:

1. Confirm the exact product, variant, quantity, mandatory mark, retail price, discount, shipping,
   tax, total, customer email, and policy links before payment.
2. Confirm Shopify records payment once and the API processes one signed `orders/create` delivery.
3. Confirm Printful imports the correct sync variant and files. If manual order confirmation is
   enabled in Printful, inspect and approve it; otherwise cancel immediately if anything is wrong.
4. Confirm the owner payment method is charged by Printful, production begins, and no unexpected
   shipping or tax adjustment appears.
5. Confirm Printful fulfillment and tracking return to Shopify and the signed fulfillment webhook
   updates the existing API order without creating a duplicate.
6. Confirm the customer receives only the intended Shopify notifications and tracking link.
7. Exercise cancellation/refund handling while still possible and confirm any enabled verified
   reward entry reverses exactly once. Rewards must remain disabled unless their separate consent,
   identity, notice, and privacy requirements are met.
8. Inspect the delivered item for design placement, `Made By +U, 4 ALL`, color, size, print quality,
   packaging, return address, and delivery time. Record owner approval before removing the storefront
   password or adding a canonical-site link.

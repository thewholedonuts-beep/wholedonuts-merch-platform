# Whole Donuts Merch Platform

Private sponsor merchandise operations built with a Next.js dashboard, Express API, PostgreSQL, Shopify, and Printful fulfillment. Shopify is the public checkout and order system of record; PostgreSQL stores Whole Donuts sponsor, consent, referral, reward-ledger, and operational data. Printify remains a disabled future adapter, not a launch provider.

## Launch status

This repository does not establish a public storefront or a production destination. The dashboard is invitation-only and its placeholder domains are examples, not live services. Do not link it from the canonical Whole Donuts site until the owner confirms a production HTTPS destination, the relevant catalog/design rights, checkout and fulfillment readiness, and privacy terms for any referral program.

## Production architecture

```text
https://merch.example.com       Next.js dashboard
             |
https://merch-api.example.com   Express API, Shopify webhooks, fulfillment-provider operations
             |
           private managed PostgreSQL
```

Deploy the dashboard and API as separate managed HTTPS services on one provider with managed PostgreSQL. The database must remain private to the provider network. Use `docker-compose.production.example.yml` only as a service definition; it intentionally does not provision a database, TLS endpoint, reverse proxy, or secrets.

Read [the deployment guide](docs/DEPLOYMENT.md) before creating a production service. It includes the complete environment-value matrix, release procedure, and rollback steps.

## Local development

1. Copy `.env.example` to `backend/.env` and replace the local database value.
2. Run `npm ci` in both `backend/` and `frontend/`.
3. Create the local PostgreSQL database, then run `npm run migrate` from `backend/`.
4. Start `npm run dev` from both service directories.
5. Open `http://localhost:3000`; the API health endpoint is `http://localhost:3001/health`.

The frontend reads `NEXT_PUBLIC_API_BASE_URL`. It is public build-time configuration, never a secret. The backend reads secrets only from its runtime environment.

## Service commands

| Directory | Command | Purpose |
|---|---|---|
| `backend/` | `npm start` | Run the Express API |
| `backend/` | `npm run migrate` | Apply tracked forward-only migrations |
| `backend/` | `npm run refresh-sponsor-metrics` | Run the scheduled metric refresh once |
| `backend/` | `npm test` | Test webhook HMAC verification |
| `frontend/` | `npm run build` | Build the production dashboard |

Run the metric refresh from one provider scheduler, not from each API instance.

## Commerce integration

- [Shopify setup](docs/SHOPIFY_SETUP.md) covers the custom app, scopes, verified webhook topics, and callback URL.
- [Shopify + Printful launch](docs/SHOPIFY_PRINTFUL_LAUNCH.md) is the authoritative account, secrets, policy, mapping, workflow, and paid test-order checklist.
- [Fulfillment provider setup](docs/FULFILLMENT_PROVIDERS.md) records the Printful-only launch boundary and future Printify gate.
- `POST /api/orders/webhook/shopify` accepts only configured topics with a valid Shopify HMAC and webhook delivery ID. Replayed deliveries are acknowledged without reprocessing.
- `GET /api/fulfillment/:provider/status` and `POST /api/fulfillment/:provider/reconcile-catalog` are operator-only provider checks. Do not expose integration tokens to the frontend.

Catalog products imported from Shopify start inactive and are not returned by public catalog or customization endpoints until an operator explicitly approves them. Public product responses exclude provider IDs, cost, and markup. Sponsor self-registration, journey analytics, and Crumb Saver rewards remain disabled unless deliberately enabled after owner and privacy review. Raw public click/share events never create financial rewards; only trusted invite-acceptance events and verified paid Shopify webhooks write to the reward ledger.

Customizable goods carry the server-enforced signature `Made By +U, 4 ALL` at the left side or sleeve. The signature cannot be removed by client input. This repository does not grant logo or downloadable-asset rights.

Whole Donuts is an LLC, not a nonprofit. Voluntary support to Whole Donuts LLC is not tax-deductible, not a purchase, not an investment, and does not automatically earn rewards. Contributions may also be time, skill, encouragement, sharing, or simply showing up; financial amount does not determine a person's value or Crumb Saver eligibility.

## Security boundary

Browser sessions use HttpOnly, Secure production cookies; the API enforces CSRF validation for cookie-authenticated mutations. Sponsor access remains scoped to the authenticated sponsor. Operator-only routes require the separate `X-Operator-Key` credential, whose value must be stored in the provider secret manager and sent only by trusted operations tooling.

See [data retention and consent](docs/DATA_RETENTION.md) before enabling rewards or analytics.

# Production deployment guide

## Required topology

Run two public HTTPS services and one private managed PostgreSQL instance:

| Service | Public URL | Command | Probe |
|---|---|---|---|
| Dashboard | `https://<merch-domain>` | `node server.js` from the frontend image | Host HTTP probe |
| API | `https://<api-domain>` | `node src/server.js` from the backend image | `/health` liveness, `/ready` database readiness |
| Metrics job | No public URL | `npm run refresh-sponsor-metrics` | Provider-scheduled hourly execution |
| PostgreSQL | Private only | Managed service | Provider health/backup monitoring |

Build images from the repository root:

```bash
docker build -f backend/Dockerfile -t whole-donuts-merch-api .
docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://<api-domain>/api -f frontend/Dockerfile -t whole-donuts-merch-web .
```

The frontend API base URL is public and baked into the frontend build. Every other value below belongs in the API service secret store.

## Production values

| Variable | Value source |
|---|---|
| `DATABASE_URL` | Managed private PostgreSQL TLS connection string |
| `FRONTEND_URLS` | Comma-separated exact dashboard origins, such as `https://<merch-domain>` |
| `PUBLIC_API_URL` | Exact public HTTPS API origin, without a path |
| `JWT_SECRET`, `OPERATOR_API_KEY` | Two distinct cryptographically random values, each at least 32 characters |
| `RATE_LIMIT_KEY_SALT` | A third distinct random value of at least 32 characters for keyed account rate-limit identifiers |
| `ALLOW_SPONSOR_SELF_REGISTRATION` | Keep `false` unless the owner has approved a public account-creation flow |
| `REFERRAL_ANALYTICS_ENABLED` | Keep `false` unless the owner has approved the referral collection purpose, notice, retention, and access controls |
| `CRUMB_SAVER_REWARDS_ENABLED` | Keep `false` until trusted acceptance callbacks and paid-order reward rules are approved |
| `IP_HASH_SALT` | Cryptographically random value of at least 32 characters; required only when referral analytics are enabled |
| `REWARD_REFERENCE_SALT` | Distinct random value of at least 32 characters; required when analytics or rewards are enabled |
| `REWARDS_PRIVACY_NOTICE_VERSION` | Exact owner/legal-approved notice version accepted by sponsors; required when rewards are enabled |
| `REFERRAL_RETENTION_DAYS`, `INTEGRATION_EVENT_RETENTION_DAYS` | Approved retention windows; defaults are 365 and 30 days |
| `JWT_EXPIRES_IN`, `SESSION_COOKIE_MAX_AGE_SECONDS` | Matching short session lifetime, such as `8h` and `28800` |
| `SHOPIFY_STORE_URL` | Shopify hostname only |
| `SHOPIFY_API_VERSION` | Supported stable Shopify Admin API version, such as `2026-07` |
| `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET` | Shopify custom app |
| `SHOPIFY_WEBHOOK_TOPICS` | Exact subscribed topics |
| `FULFILLMENT_PROVIDERS` | `printful` for launch |
| `DEFAULT_FULFILLMENT_PROVIDER` | `printful` for launch |
| `PRINTFUL_API_KEY`, `PRINTFUL_STORE_ID` | Store-limited Printful token and selected store ID |
| `NEXT_PUBLIC_API_BASE_URL` | `https://<api-domain>/api`; frontend build environment only |
| `TRUST_PROXY` | Managed host proxy hop count, normally `1` |
| `DATABASE_SSL_CA` | Provider CA only when required; retain verified TLS by default |

Set `NODE_ENV=production`. Production startup fails when its required configuration is missing, insecure TLS is selected without explicit acknowledgement, origins are not HTTPS, or the Shopify store value is malformed.

The dashboard is an invitation-only operations portal, not a public storefront. Sponsor self-registration, referral analytics, and Crumb Saver rewards are disabled unless their explicit opt-in settings are enabled. A sponsor must also record consent against an approved privacy-notice version before rewards can accrue. Anonymous product exploration does not create an account or journey record.

Whole Donuts LLC is not a nonprofit. Keep voluntary support records separate from purchases and verified reward events; support is not tax-deductible, a purchase, or an investment and does not automatically earn rewards.

## Release procedure

1. Create the private managed PostgreSQL instance with encryption, point-in-time recovery, and a dedicated least-privilege application role. Use a distinct migration role where the provider supports it.
2. Configure API runtime secrets and frontend build-time API URL. Do not commit `.env` files or expose API/service tokens in browser variables.
3. Run `npm run migrate` as a one-off release command against the target database. Confirm `pgcrypto` can be installed and all four migrations complete before starting new application versions.
4. Deploy the API, wait for `/ready`, then deploy the dashboard. Configure the provider scheduler to run the metric refresh command once each hour.
5. Configure custom domains, DNS, and managed TLS. Restrict CORS to the deployed dashboard origin.
6. Register Shopify webhooks only after the API is healthy; complete the Shopify and enabled fulfillment-provider release checks.
7. Follow the [Shopify + Printful launch runbook](SHOPIFY_PRINTFUL_LAUNCH.md), including the protected dispatch workflow, signed deployed-receiver probe, operator reconciliation, and complete Printful product/variant/approved-branding-file mapping for every active item.
8. Schedule deletion or minimization of expired referral, validation, integration-event, and reward-ledger records according to [the retention policy](DATA_RETENTION.md).
9. Bind each consenting rewards sponsor to a verified Shopify customer ID through the operator-only `PUT /api/sponsors/:id/reward-identity` endpoint. Unbound sponsors cannot earn purchase or acceptance rewards.
10. Reconcile inventory before activation. Product inventory is the aggregate sales cap and each active variant has its own cap; both are transactionally decremented for variant orders.
11. Configure edge/WAF burst controls and short-retention logs as described in the launch runbook. Never impose one email/account per IP; challenge or manually review suspicious churn while allowing legitimate shared networks.

For local concurrency validation, set `TEST_DATABASE_URL` to a migrated disposable PostgreSQL
database before running `npm test`. CI provisions PostgreSQL 16 and runs this path automatically.

## Rollback and operations

Keep the previous service image available. Roll back service images independently when a release fails, but do not roll back database migrations by deleting data. Use forward-only corrective migrations. Review API logs by request ID and alert on readiness failures, webhook failures, and scheduled-job failures.

Test a database restore before production launch and at the interval required by Whole Donuts operations. Rotate Shopify, Printful, operator, session, and referral secrets through the provider secret manager; redeploy affected services after each rotation.

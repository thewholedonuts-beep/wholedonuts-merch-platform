# Consent, rewards, and data retention

Anonymous catalog and customization exploration must remain available without an account and must not create a journey record. Sponsor accounts are optional for public customers and are limited to the private sponsor program.

Whole Donuts is an LLC, not a nonprofit. Any monetary support is **voluntary support to Whole Donuts LLC**. It is not tax-deductible, not a purchase, not an investment, and does not automatically earn rewards. Financial support records remain separate from Shopify commerce and the verified reward ledger.

A Crumb can be money, time, a skill, encouragement, sharing, or simply showing up. The system must not rank human worth by money. Crumb Saver levels are based only on eligible verified reward-ledger activity and are not derived from the legacy `total_contribution` financial record.

Migration `003_commerce_hardening.sql` clears pre-ledger effort scores and discounts because their provenance cannot be verified. Operators must not restore those values without auditable acceptance or paid-purchase evidence.

Crumb Saver rewards require both the `CRUMB_SAVER_REWARDS_ENABLED=true` release gate and explicit sponsor consent recorded against an approved privacy-notice version. `PUT /api/sponsors/me/consent` records grants and withdrawals in `sponsor_consent_events`. Withdrawal stops future acceptance and purchase awards.

Financial rewards may originate only from:

- `POST /api/referral/acceptance`, called by trusted operator/server tooling after an invited recipient has verifiably accepted or registered. Normalized Shopify customer IDs are HMAC-hashed before storage and duplicate acceptances are ignored.
- A verified Shopify order webhook whose financial status is `paid`. Replayed deliveries and duplicate order awards are ignored.

Public click, share, validation, and customization requests never grant discounts or entitlements. Refunded, voided, or cancelled Shopify orders create one compensating reward-ledger reversal. Operators must review suspicious activity and may revoke related entitlements.

Operators bind a consenting sponsor to a verified Shopify customer ID with
`PUT /api/sponsors/:id/reward-identity`. The service accepts Shopify numeric customer IDs or
equivalent Customer GIDs, normalizes them to the numeric ID, and stores only an HMAC-SHA256
reference under `REWARD_REFERENCE_SALT`. A unique identity can belong to only one sponsor reward
account. The raw customer ID is not stored on that account.

Paid-order attribution uses only `customer.id` from a signature-verified Shopify webhook. An order
without that identity cannot earn a financial reward. Email-only matching is deliberately
unsupported because an email address alone is insufficient identity evidence. Public referral
validation does not accept sponsor or purchaser identity claims.

Payment and reversal handlers take the same transaction-scoped PostgreSQL advisory lock for each
Shopify order. Conflicting events therefore serialize, including reversal-before-payment
tombstones. Internal order reservation locks active product and variant rows in deterministic
order, checks both aggregate product stock and selected variant stock, and decrements them in the
same transaction as order creation.

`sponsor_entitlements` is the boundary for future `course_download` and `merch_customization` grants. No course file, image, logo, or download right is created by this schema. Do not publish or distribute assets until ownership and license approval is recorded outside this repository.

The configured retention windows populate `retention_expires_at` on referral, validation, integration, and reward-ledger records. Before enabling collection, approve a deletion or irreversible-minimization job, data-subject access/deletion procedure, incident response owner, and access policy. The application does not yet delete expired records automatically; operating that cleanup is a production blocker.

The PostgreSQL concurrency tests run when `TEST_DATABASE_URL` points to a migrated disposable
database. They are skipped in database-free unit runs and run against PostgreSQL 16 in CI.

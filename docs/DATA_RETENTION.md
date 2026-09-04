# Consent, rewards, and data retention

Anonymous catalog and customization exploration must remain available without an account and must not create a journey record. Sponsor accounts are optional for public customers and are limited to the private sponsor program.

Whole Donuts is an LLC, not a nonprofit. Any monetary support is **voluntary support to Whole Donuts LLC**. It is not tax-deductible, not a purchase, not an investment, and does not automatically earn rewards. Financial support records remain separate from Shopify commerce and the verified reward ledger.

A Crumb can be money, time, a skill, encouragement, sharing, or simply showing up. The system must not rank human worth by money. Crumb Saver levels are based only on eligible verified reward-ledger activity and are not derived from the legacy `total_contribution` financial record.

Migration `003_commerce_hardening.sql` clears pre-ledger effort scores and discounts because their provenance cannot be verified. Operators must not restore those values without auditable acceptance or paid-purchase evidence.

Crumb Saver rewards require both the `CRUMB_SAVER_REWARDS_ENABLED=true` release gate and explicit sponsor consent recorded against an approved privacy-notice version. `PUT /api/sponsors/me/consent` records grants and withdrawals in `sponsor_consent_events`. Withdrawal stops future acceptance and purchase awards.

Financial rewards may originate only from:

- `POST /api/referral/acceptance`, called by trusted operator/server tooling after an invited recipient has verifiably accepted or registered. Recipient references are HMAC-hashed before storage and duplicate acceptances are ignored.
- A verified Shopify order webhook whose financial status is `paid`. Replayed deliveries and duplicate order awards are ignored.

Public click, share, validation, and customization requests never grant discounts or entitlements. Refunded, voided, or cancelled Shopify orders create one compensating reward-ledger reversal. Operators must review suspicious activity and may revoke related entitlements.

`sponsor_entitlements` is the boundary for future `course_download` and `merch_customization` grants. No course file, image, logo, or download right is created by this schema. Do not publish or distribute assets until ownership and license approval is recorded outside this repository.

The configured retention windows populate `retention_expires_at` on referral, validation, integration, and reward-ledger records. Before enabling collection, approve a deletion or irreversible-minimization job, data-subject access/deletion procedure, incident response owner, and access policy. The application does not yet delete expired records automatically; operating that cleanup is a production blocker.

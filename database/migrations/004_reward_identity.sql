ALTER TABLE sponsors
  ADD COLUMN reward_identity_hash VARCHAR(64),
  ADD COLUMN reward_identity_bound_at TIMESTAMPTZ;

COMMENT ON COLUMN sponsors.reward_identity_hash IS
  'HMAC of a normalized server-verified provider and subject identifier; never derived from an unverified email claim.';

ALTER TABLE orders
  ADD COLUMN customer_identity_hash VARCHAR(64);

COMMENT ON COLUMN orders.customer_identity_hash IS
  'HMAC of the verified Shopify webhook customer ID used for referral abuse prevention.';

CREATE UNIQUE INDEX idx_sponsors_reward_identity
  ON sponsors (reward_identity_hash)
  WHERE reward_identity_hash IS NOT NULL;

ALTER TABLE products
  ADD COLUMN fulfillment_provider VARCHAR(50) NOT NULL DEFAULT 'printful'
    CHECK (fulfillment_provider IN ('printful', 'printify')),
  ADD COLUMN fulfillment_product_id VARCHAR(255),
  ADD COLUMN requires_signature_branding BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN signature_text VARCHAR(100) NOT NULL DEFAULT 'Made By +U, 4 ALL',
  ADD COLUMN signature_placement VARCHAR(100) NOT NULL DEFAULT 'left-side-or-sleeve',
  ADD CONSTRAINT products_signature_branding
    CHECK (
      requires_signature_branding = false
      OR (
        signature_text = 'Made By +U, 4 ALL'
        AND signature_placement = 'left-side-or-sleeve'
      )
    );

UPDATE products
SET fulfillment_product_id = printful_product_id
WHERE printful_product_id IS NOT NULL
  AND fulfillment_product_id IS NULL;

UPDATE products
SET requires_signature_branding = true
WHERE cardinality(print_methods) > 0;

CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  shopify_variant_id VARCHAR(255) UNIQUE,
  sku VARCHAR(255),
  title VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  inventory_count INTEGER NOT NULL DEFAULT 0 CHECK (inventory_count >= 0),
  fulfillment_variant_id VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_variants_product
  ON product_variants (product_id, active);

CREATE INDEX idx_products_fulfillment_mapping
  ON products (fulfillment_provider, fulfillment_product_id);

ALTER TABLE sponsors
  ADD COLUMN rewards_consent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN rewards_consent_at TIMESTAMPTZ,
  ADD COLUMN rewards_consent_withdrawn_at TIMESTAMPTZ,
  ADD COLUMN privacy_notice_version VARCHAR(100);

ALTER TABLE sponsors DROP CONSTRAINT IF EXISTS sponsors_tier_check;
ALTER TABLE sponsors ALTER COLUMN tier SET DEFAULT 'crumb';

UPDATE sponsors
SET effort_score = 0,
    discount_earned = 0,
    tier = 'crumb',
    customization_limit = 1;

ALTER TABLE sponsors
  ADD CONSTRAINT sponsors_tier_check CHECK (tier IN ('crumb', 'maker', 'community'));

COMMENT ON COLUMN sponsors.total_contribution IS
  'Voluntary financial support to Whole Donuts LLC; not a purchase, investment, tax-deductible donation, or automatic reward input.';

CREATE TABLE sponsor_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  purpose VARCHAR(100) NOT NULL CHECK (purpose IN ('referral_rewards')),
  granted BOOLEAN NOT NULL,
  policy_version VARCHAR(100),
  source VARCHAR(100) NOT NULL DEFAULT 'sponsor_portal',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sponsor_consent_events_sponsor
  ON sponsor_consent_events (sponsor_id, recorded_at DESC);

CREATE TABLE reward_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  referral_code_id UUID REFERENCES referral_codes(id) ON DELETE SET NULL,
  event_type VARCHAR(50) NOT NULL
    CHECK (event_type IN ('verified_acceptance', 'paid_purchase', 'reversal')),
  source_reference VARCHAR(255) NOT NULL,
  points_delta DECIMAL(10,2) NOT NULL CHECK (points_delta <> 0),
  reverses_entry_id UUID REFERENCES reward_ledger(id),
  metadata JSONB NOT NULL DEFAULT '{}',
  retention_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_type, source_reference)
);

CREATE UNIQUE INDEX idx_reward_ledger_single_reversal
  ON reward_ledger (reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

CREATE INDEX idx_reward_ledger_sponsor
  ON reward_ledger (sponsor_id, created_at DESC);

CREATE TABLE sponsor_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  entitlement_type VARCHAR(50) NOT NULL
    CHECK (entitlement_type IN ('course_download', 'merch_customization')),
  entitlement_key VARCHAR(255) NOT NULL,
  reward_level VARCHAR(100),
  source_ledger_id UUID REFERENCES reward_ledger(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (sponsor_id, entitlement_type, entitlement_key)
);

ALTER TABLE referral_events
  ADD COLUMN retention_expires_at TIMESTAMPTZ;

ALTER TABLE code_validations
  ADD COLUMN retention_expires_at TIMESTAMPTZ;

ALTER TABLE integration_events
  ADD COLUMN retention_expires_at TIMESTAMPTZ;

CREATE TABLE pending_shopify_fulfillments (
  shopify_order_id VARCHAR(255) PRIMARY KEY,
  fulfillment_status VARCHAR(50) NOT NULL
    CHECK (fulfillment_status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  tracking_number VARCHAR(255),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention_expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE pending_shopify_reward_reversals (
  shopify_order_id VARCHAR(255) PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention_expires_at TIMESTAMPTZ NOT NULL
);

DELETE FROM referral_events
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY order_id
             ORDER BY created_at, id
           ) AS duplicate_number
    FROM referral_events
    WHERE event_type = 'conversion' AND order_id IS NOT NULL
  ) duplicate_conversions
  WHERE duplicate_number > 1
);

CREATE UNIQUE INDEX idx_referral_conversion_order
  ON referral_events (order_id)
  WHERE event_type = 'conversion' AND order_id IS NOT NULL;

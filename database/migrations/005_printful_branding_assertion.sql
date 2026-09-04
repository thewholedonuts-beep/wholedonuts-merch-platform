ALTER TABLE product_variants
  ADD COLUMN fulfillment_branding_file_id VARCHAR(255),
  ADD COLUMN fulfillment_branding_placement VARCHAR(100),
  ADD CONSTRAINT product_variants_branding_mapping_complete
    CHECK (
      (fulfillment_branding_file_id IS NULL AND fulfillment_branding_placement IS NULL)
      OR
      (fulfillment_branding_file_id IS NOT NULL AND fulfillment_branding_placement IS NOT NULL)
    );

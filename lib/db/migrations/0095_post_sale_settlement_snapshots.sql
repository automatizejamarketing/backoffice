ALTER TABLE "product_post_sale_cost_settlements"
  ADD COLUMN IF NOT EXISTS "movement_snapshot_hash" varchar(64),
  ADD COLUMN IF NOT EXISTS "calculation_snapshot" jsonb;

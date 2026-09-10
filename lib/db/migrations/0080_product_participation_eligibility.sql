-- Additive cutover for the per-product participation agreement.
-- Historical orders keep NULL platform participation and the legacy rule marker.

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_expert_participation_range";--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_expert_participation_range"
  CHECK (
    "expert_participation_bps" IS NULL
    OR ("expert_participation_bps" >= 0 AND "expert_participation_bps" <= 9999)
  );--> statement-breakpoint

ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "platform_participation_bps" integer;--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "participation_rule_version" varchar(40) NOT NULL DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "product_orders"
  DROP CONSTRAINT IF EXISTS "product_orders_participation_snapshot_range";--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD CONSTRAINT "product_orders_participation_snapshot_range"
  CHECK (
    "platform_participation_bps" IS NULL
    OR ("platform_participation_bps" >= 0 AND "platform_participation_bps" <= 9999)
  );

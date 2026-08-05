ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "platform_fee_basis_points_override" integer;--> statement-breakpoint

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_platform_fee_override_range";--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_platform_fee_override_range"
  CHECK (
    "platform_fee_basis_points_override" IS NULL
    OR (
      "platform_fee_basis_points_override" >= 0
      AND "platform_fee_basis_points_override" <= 10000
    )
  );

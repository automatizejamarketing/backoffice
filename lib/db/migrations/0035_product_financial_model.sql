CREATE TABLE IF NOT EXISTS "product_financial_settings" (
  "id" varchar(32) PRIMARY KEY DEFAULT 'default' NOT NULL,
  "platform_fee_basis_points" integer DEFAULT 500 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_financial_settings_platform_fee_range"
    CHECK ("platform_fee_basis_points" >= 0 AND "platform_fee_basis_points" <= 10000)
);--> statement-breakpoint

INSERT INTO "product_financial_settings" (
  "id",
  "platform_fee_basis_points"
)
VALUES ('default', 500)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "financial_model" varchar DEFAULT 'legacy_net_split' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "platform_fee_basis_points" integer;--> statement-breakpoint

ALTER TABLE "product_orders"
  DROP CONSTRAINT IF EXISTS "product_orders_snapshot_consistency";--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD CONSTRAINT "product_orders_snapshot_consistency"
  CHECK (
    "price_centavos" >= 0
    AND "currency" = 'brl'
    AND "expert_share_basis_points" >= 0
    AND "expert_share_basis_points" <= 10000
    AND (
      ("expert_id_snapshot" IS NULL AND "expert_share_basis_points" = 0)
      OR "expert_id_snapshot" IS NOT NULL
    )
    AND (
      ("financial_model" = 'legacy_net_split' AND "platform_fee_basis_points" IS NULL)
      OR (
        "financial_model" = 'platform_fee_coproduction'
        AND "platform_fee_basis_points" >= 0
        AND "platform_fee_basis_points" <= 10000
      )
    )
  );--> statement-breakpoint

ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "payment_method_id" varchar(80);--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "payment_type_id" varchar(80);--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "provider_release_at" timestamp;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "platform_fee_gross_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "platform_gateway_net_revenue_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "coproduction_base_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "expert_receivable_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "automatize_coproduction_revenue_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "automatize_product_revenue_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "automatize_total_net_revenue_centavos" integer;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "coproducer_type" varchar;--> statement-breakpoint
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "coproducer_expert_id" uuid;--> statement-breakpoint
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "coproducer_share_basis_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

UPDATE "products"
SET
  "coproducer_type" = CASE
    WHEN "owner_type" = 'expert' AND "expert_share_basis_points" < 10000
      THEN 'automatize'
    ELSE NULL
  END,
  "coproducer_expert_id" = NULL,
  "coproducer_share_basis_points" = CASE
    WHEN "owner_type" = 'expert'
      THEN 10000 - "expert_share_basis_points"
    ELSE 0
  END;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "products"
    ADD CONSTRAINT "products_coproducer_expert_id_expert_profiles_id_fk"
    FOREIGN KEY ("coproducer_expert_id")
    REFERENCES "public"."expert_profiles"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_coproducer_expert_id_idx"
  ON "products" USING btree ("coproducer_expert_id");--> statement-breakpoint

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_expert_share_range";--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_expert_share_range"
  CHECK (
    "expert_share_basis_points" >= 0
    AND "expert_share_basis_points" <= 10000
    AND "coproducer_share_basis_points" >= 0
    AND "coproducer_share_basis_points" <= 10000
  );--> statement-breakpoint

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_owner_consistency";--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_owner_consistency"
  CHECK (
    (
      "owner_type" = 'automatize'
      AND "expert_id" IS NULL
      AND "expert_share_basis_points" = 0
      AND "coproducer_type" IS NULL
      AND "coproducer_expert_id" IS NULL
      AND "coproducer_share_basis_points" = 0
    )
    OR (
      "owner_type" = 'expert'
      AND "expert_id" IS NOT NULL
      AND "expert_share_basis_points" + "coproducer_share_basis_points" = 10000
      AND (
        (
          "coproducer_type" IS NULL
          AND "coproducer_expert_id" IS NULL
          AND "coproducer_share_basis_points" = 0
        )
        OR (
          "coproducer_type" = 'automatize'
          AND "coproducer_expert_id" IS NULL
          AND "coproducer_share_basis_points" > 0
        )
        OR (
          "coproducer_type" = 'expert'
          AND "coproducer_expert_id" IS NOT NULL
          AND "coproducer_expert_id" <> "expert_id"
          AND "coproducer_share_basis_points" > 0
        )
      )
    )
  );--> statement-breakpoint

ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "coproducer_type_snapshot" varchar;--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "coproducer_expert_id_snapshot" uuid;--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "coproducer_share_basis_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "product_orders"
    ADD CONSTRAINT "product_orders_coproducer_expert_id_snapshot_expert_profiles_id_fk"
    FOREIGN KEY ("coproducer_expert_id_snapshot")
    REFERENCES "public"."expert_profiles"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "product_orders"
  DROP CONSTRAINT IF EXISTS "product_orders_snapshot_consistency";--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD CONSTRAINT "product_orders_snapshot_consistency"
  CHECK (
    "price_centavos" >= 0
    AND "currency" = 'brl'
    AND "expert_share_basis_points" >= 0
    AND "expert_share_basis_points" <= 10000
    AND "coproducer_share_basis_points" >= 0
    AND "coproducer_share_basis_points" <= 10000
    AND (
      (
        "financial_model" = 'legacy_net_split'
        AND "platform_fee_basis_points" IS NULL
        AND (
          ("expert_id_snapshot" IS NULL AND "expert_share_basis_points" = 0)
          OR "expert_id_snapshot" IS NOT NULL
        )
      )
      OR (
        "financial_model" = 'platform_fee_coproduction'
        AND "platform_fee_basis_points" >= 0
        AND "platform_fee_basis_points" <= 10000
        AND (
          ("expert_id_snapshot" IS NULL AND "expert_share_basis_points" = 0)
          OR "expert_id_snapshot" IS NOT NULL
        )
      )
      OR (
        "financial_model" = 'platform_fee_coproduction_v2'
        AND "platform_fee_basis_points" >= 0
        AND "platform_fee_basis_points" <= 10000
        AND (
          (
            "expert_id_snapshot" IS NULL
            AND "expert_share_basis_points" = 0
            AND "coproducer_type_snapshot" IS NULL
            AND "coproducer_expert_id_snapshot" IS NULL
            AND "coproducer_share_basis_points" = 0
          )
          OR (
            "expert_id_snapshot" IS NOT NULL
            AND "expert_share_basis_points" + "coproducer_share_basis_points" = 10000
            AND (
              (
                "coproducer_type_snapshot" IS NULL
                AND "coproducer_expert_id_snapshot" IS NULL
                AND "coproducer_share_basis_points" = 0
              )
              OR (
                "coproducer_type_snapshot" = 'automatize'
                AND "coproducer_expert_id_snapshot" IS NULL
                AND "coproducer_share_basis_points" > 0
              )
              OR (
                "coproducer_type_snapshot" = 'expert'
                AND "coproducer_expert_id_snapshot" IS NOT NULL
                AND "coproducer_expert_id_snapshot" <> "expert_id_snapshot"
                AND "coproducer_share_basis_points" > 0
              )
            )
          )
        )
      )
    )
  );--> statement-breakpoint

ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "coproducer_expert_receivable_centavos" integer;

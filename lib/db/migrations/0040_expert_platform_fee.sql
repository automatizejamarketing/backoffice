ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "platform_fee_basis_points" integer DEFAULT 549 NOT NULL;--> statement-breakpoint
ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "platform_fee_fixed_centavos" integer DEFAULT 39 NOT NULL;--> statement-breakpoint
ALTER TABLE "expert_profiles"
  DROP CONSTRAINT IF EXISTS "expert_profiles_platform_fee_range";--> statement-breakpoint
ALTER TABLE "expert_profiles"
  ADD CONSTRAINT "expert_profiles_platform_fee_range"
  CHECK (
    "platform_fee_basis_points" >= 0
    AND "platform_fee_basis_points" <= 10000
    AND "platform_fee_fixed_centavos" >= 0
  );--> statement-breakpoint

ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "platform_fee_fixed_centavos" integer;--> statement-breakpoint
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
        AND "platform_fee_fixed_centavos" IS NULL
        AND (
          ("expert_id_snapshot" IS NULL AND "expert_share_basis_points" = 0)
          OR "expert_id_snapshot" IS NOT NULL
        )
      )
      OR (
        "financial_model" = 'platform_fee_coproduction'
        AND "platform_fee_basis_points" >= 0
        AND "platform_fee_basis_points" <= 10000
        AND "platform_fee_fixed_centavos" IS NULL
        AND (
          ("expert_id_snapshot" IS NULL AND "expert_share_basis_points" = 0)
          OR "expert_id_snapshot" IS NOT NULL
        )
      )
      OR (
        "financial_model" = 'platform_fee_coproduction_v2'
        AND "platform_fee_basis_points" >= 0
        AND "platform_fee_basis_points" <= 10000
        AND "platform_fee_fixed_centavos" IS NULL
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
      OR (
        "financial_model" = 'platform_fee_coproduction_v3'
        AND "platform_fee_basis_points" >= 0
        AND "platform_fee_basis_points" <= 10000
        AND "platform_fee_fixed_centavos" >= 0
        AND (
          (
            "expert_id_snapshot" IS NULL
            AND "platform_fee_basis_points" = 0
            AND "platform_fee_fixed_centavos" = 0
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
  );

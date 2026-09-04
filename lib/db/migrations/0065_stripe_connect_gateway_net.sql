-- M1 — Conta Stripe do Expert, gateway_net_v1 e trilho de repasse (ticket 13).
-- Espelhado byte-a-byte no backoffice como 0065_stripe_connect_gateway_net,
-- com o MESMO `when` (1795000000000). Estritamente aditivo.

ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "stripe_account_id" varchar(255);--> statement-breakpoint
ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "stripe_charges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "stripe_payouts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "stripe_details_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "stripe_account_updated_at" timestamp;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "expert_profiles_stripe_account_id_unique"
  ON "expert_profiles" ("stripe_account_id")
  WHERE "stripe_account_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "gateway_fee_estimate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "gateway_fee_estimate_fixed_centavos" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "stripe_account_id" varchar(255);--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "expert_settlement" varchar(16);--> statement-breakpoint

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
      OR (
        "financial_model" = 'gateway_net_v1'
        AND "platform_fee_basis_points" = 0
        AND "platform_fee_fixed_centavos" = 0
        AND "marketplace_fee_basis_points" = 0
        AND "gateway_fee_estimate_bps" >= 0
        AND "gateway_fee_estimate_fixed_centavos" >= 0
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
            )
          )
        )
      )
      OR (
        "financial_model" = 'vindi_split_v1'
        AND "expert_participation_bps" >= 0
        AND "expert_participation_bps" <= 10000
        AND "processing_fee_basis_points" >= 0
        AND "processing_fee_basis_points" <= 10000
        AND (
          "expert_amount_centavos" IS NULL
          OR "expert_amount_centavos" >= 0
        )
        AND (
          "platform_theoretical_amount_centavos" IS NULL
          OR "platform_theoretical_amount_centavos" >= 0
        )
        AND "platform_fee_basis_points" IS NULL
        AND "platform_fee_fixed_centavos" IS NULL
        AND "expert_share_basis_points" = 0
        AND "coproducer_share_basis_points" = 0
        AND "coproducer_type_snapshot" IS NULL
        AND "coproducer_expert_id_snapshot" IS NULL
        AND (
          ("expert_id_snapshot" IS NULL AND "expert_participation_bps" = 0)
          OR "expert_id_snapshot" IS NOT NULL
        )
      )
    )
  );

-- Expand aditivo do modelo Vindi (ticket 03). Espelhado byte-a-byte no
-- backoffice como 0048_vindi_expand, com o MESMO `when` (1794530000000):
-- quem migrar primeiro aplica; o outro pula. Flags OFF — nenhuma linha
-- nova é escrita por este arquivo; só estrutura.
--
-- Estritamente aditivo: colunas/tabelas/valores novos. O único DROP é
-- o da CHECK `product_orders_snapshot_consistency`, recriada com os
-- ramos v3 intactos mais o ramo `vindi_split_v1`. `products_owner_consistency`
-- e `expert_share_basis_points` não são tocados.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "vindi_customer_id" varchar(255);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "users_vindi_customer_id_unique"
  ON "users" ("vindi_customer_id")
  WHERE "vindi_customer_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "vindi_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "vindi_payment_method" varchar;--> statement-breakpoint
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "vindi_consent_status" varchar;--> statement-breakpoint
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "vindi_consent_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "vindi_consent_authorized_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "vindi_consent_expires_at" timestamp;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_vindi_subscription_id_unique"
  ON "subscriptions" ("vindi_subscription_id")
  WHERE "vindi_subscription_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "vindi_bill_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "vindi_charge_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "purpose" varchar;--> statement-breakpoint
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "payment_method" varchar;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payments_vindi_charge_id_unique"
  ON "payments" ("vindi_charge_id")
  WHERE "vindi_charge_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vindi_payment_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "plan_type" varchar,
  "purpose" varchar NOT NULL,
  "amount" integer NOT NULL,
  "currency" varchar(10) DEFAULT 'brl' NOT NULL,
  "emv_payload" text,
  "vindi_bill_id" varchar(255),
  "vindi_charge_id" varchar(255),
  "status" varchar DEFAULT 'pending' NOT NULL,
  "source" varchar NOT NULL,
  "expires_at" timestamp NOT NULL,
  "paid_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "vindi_payment_links_vindi_bill_id_unique"
  ON "vindi_payment_links" ("vindi_bill_id")
  WHERE "vindi_bill_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vindi_payment_links_user_id_idx"
  ON "vindi_payment_links" ("user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vindi_webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" varchar(128) NOT NULL,
  "payload" jsonb NOT NULL,
  "idempotency_key" varchar(255),
  "received_at" timestamp DEFAULT now() NOT NULL,
  "processed_at" timestamp
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "vindi_webhook_events_idempotency_key_unique"
  ON "vindi_webhook_events" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vindi_webhook_events_received_at_idx"
  ON "vindi_webhook_events" ("received_at");--> statement-breakpoint

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "expert_participation_bps" integer;--> statement-breakpoint

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_expert_participation_range";--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_expert_participation_range"
  CHECK (
    "expert_participation_bps" IS NULL
    OR (
      "expert_participation_bps" >= 0
      AND "expert_participation_bps" <= 10000
    )
  );--> statement-breakpoint

ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "vindi_affiliate_id" varchar(255);--> statement-breakpoint
ALTER TABLE "expert_profiles"
  ADD COLUMN IF NOT EXISTS "vindi_affiliate_status" varchar DEFAULT 'unverified' NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "expert_profiles_vindi_affiliate_id_unique"
  ON "expert_profiles" ("vindi_affiliate_id")
  WHERE "vindi_affiliate_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "expert_participation_bps" integer;--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "processing_fee_basis_points" integer;--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "expert_amount_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "platform_theoretical_amount_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "vindi_bill_id" varchar(255);--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "vindi_charge_id" varchar(255);--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "vindi_affiliate_id" varchar(255);--> statement-breakpoint

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
  );--> statement-breakpoint

ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "financial_model" varchar;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "vindi_bill_id" varchar(255);--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "vindi_charge_id" varchar(255);--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "vindi_affiliate_id" varchar(255);--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "expert_participation_bps" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "processing_fee_basis_points" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "expert_amount_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "platform_theoretical_amount_centavos" integer;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "product_payments_vindi_charge_id_unique"
  ON "product_payments" ("vindi_charge_id")
  WHERE "vindi_charge_id" IS NOT NULL;

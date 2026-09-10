-- Aditive repair shared by the frontend and backoffice.
--
-- The two applications write the same Postgres schema but their historical
-- journals do not have the same sequence. This bridge is deliberately above
-- both watermarks and idempotent: whichever application runs first restores
-- the two tables that older journals could leave behind and normalizes the
-- participation bound that was narrowed in the backoffice journal.

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

CREATE TABLE IF NOT EXISTS "product_purchase_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid,
  "product_id" uuid NOT NULL,
  "content_item_id" uuid,
  "user_id" uuid NOT NULL,
  "event_type" varchar NOT NULL,
  "access_source" varchar(30),
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "product_purchase_evidence_order_id_product_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."product_orders"("id"),
  CONSTRAINT "product_purchase_evidence_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id"),
  CONSTRAINT "product_purchase_evidence_content_item_id_product_content_items_id_fk"
    FOREIGN KEY ("content_item_id") REFERENCES "public"."product_content_items"("id"),
  CONSTRAINT "product_purchase_evidence_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_purchase_evidence_order_occurred_idx"
  ON "product_purchase_evidence" USING btree ("order_id", "occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_purchase_evidence_product_user_occurred_idx"
  ON "product_purchase_evidence" USING btree ("product_id", "user_id", "occurred_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_pix_fraud_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "product_orders"("id"),
  "provider" varchar(30) NOT NULL,
  "provider_case_id" varchar(255) NOT NULL,
  "provider_payment_id" varchar(255) NOT NULL,
  "status" varchar NOT NULL,
  "cause" varchar(120),
  "recovered_amount_centavos" integer,
  "financial_pending" boolean NOT NULL DEFAULT false,
  "observed_at" timestamp NOT NULL,
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "product_pix_fraud_cases_provider_case_order_unique"
    UNIQUE("provider", "provider_case_id", "order_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_pix_fraud_cases_order_status_idx"
  ON "product_pix_fraud_cases" ("order_id", "status");

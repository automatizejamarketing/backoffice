ALTER TABLE "product_entitlements" ADD COLUMN "suspended_at" timestamp;
ALTER TABLE "product_entitlements" ADD COLUMN "suspended_by_card_dispute_id" uuid;

CREATE TABLE "product_card_disputes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "product_orders"("id"),
  "provider" varchar(30) NOT NULL,
  "provider_dispute_id" varchar(255) NOT NULL,
  "provider_account_id" varchar(255),
  "status" varchar NOT NULL,
  "cause" varchar(120),
  "disputed_amount_centavos" integer NOT NULL,
  "charge_amount_centavos" integer NOT NULL,
  "opened_at" timestamp NOT NULL,
  "closed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_card_disputes_provider_dispute_unique" UNIQUE("provider", "provider_dispute_id")
);
CREATE INDEX "product_card_disputes_order_id_idx" ON "product_card_disputes" ("order_id");

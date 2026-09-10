CREATE TABLE "product_reconciliation_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "product_orders"("id"),
  "payment_id" uuid REFERENCES "product_payments"("id"),
  "provider" varchar(30) NOT NULL DEFAULT 'mercadopago',
  "provider_account_id" varchar(255),
  "kind" varchar NOT NULL,
  "responsible" varchar NOT NULL,
  "status" varchar NOT NULL DEFAULT 'open',
  "attribution_proven" boolean NOT NULL DEFAULT false,
  "effective_amount_centavos" integer,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "next_review_at" timestamp NOT NULL,
  "resolved_by_user_id" uuid REFERENCES "users"("id"),
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "product_reconciliation_cases_order_kind_unique" UNIQUE("order_id", "kind")
);
CREATE INDEX "product_reconciliation_cases_status_review_idx" ON "product_reconciliation_cases"("status", "next_review_at");

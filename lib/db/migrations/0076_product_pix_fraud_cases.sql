CREATE TABLE "product_pix_fraud_cases" (
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
  CONSTRAINT "product_pix_fraud_cases_provider_case_order_unique" UNIQUE("provider", "provider_case_id", "order_id")
);
CREATE INDEX "product_pix_fraud_cases_order_status_idx" ON "product_pix_fraud_cases" ("order_id", "status");

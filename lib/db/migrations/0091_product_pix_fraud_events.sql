ALTER TABLE "product_entitlements"
  ADD COLUMN IF NOT EXISTS "suspended_by_pix_fraud_case_id" uuid;
ALTER TABLE "product_pix_fraud_cases"
  ADD COLUMN IF NOT EXISTS "provider_account_id" varchar(255);
ALTER TABLE "product_pix_fraud_cases"
  ADD COLUMN IF NOT EXISTS "responsible" varchar(20) NOT NULL DEFAULT 'automatize';
ALTER TABLE "product_pix_fraud_cases"
  ADD COLUMN IF NOT EXISTS "response_due_at" timestamp;
ALTER TABLE "product_pix_fraud_cases"
  ADD COLUMN IF NOT EXISTS "notice_sent_at" timestamp;
CREATE TABLE IF NOT EXISTS "product_pix_fraud_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "case_id" uuid NOT NULL REFERENCES "product_pix_fraud_cases"("id"),
  "provider" varchar(30) NOT NULL,
  "provider_event_id" varchar(255) NOT NULL,
  "event_type" varchar(120) NOT NULL,
  "raw_payload" jsonb NOT NULL,
  "occurred_at" timestamp NOT NULL,
  "observed_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_pix_fraud_events_provider_event_unique" UNIQUE("provider", "provider_event_id")
);
CREATE INDEX IF NOT EXISTS "product_pix_fraud_events_case_id_idx" ON "product_pix_fraud_events" ("case_id");

ALTER TABLE "product_purchase_evidence"
  ADD COLUMN IF NOT EXISTS "context" jsonb;
ALTER TABLE "product_purchase_evidence"
  ADD COLUMN IF NOT EXISTS "retention_review_at" timestamp;
ALTER TABLE "product_purchase_evidence"
  ADD COLUMN IF NOT EXISTS "retention_reason" text;
ALTER TABLE "product_purchase_evidence"
  DROP CONSTRAINT IF EXISTS "product_purchase_evidence_event_type_check";

CREATE TABLE IF NOT EXISTS "product_evidence_consultations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "product_orders"("id"),
  "viewer_kind" varchar NOT NULL,
  "viewer_user_id" uuid REFERENCES "users"("id"),
  "viewer_email" varchar(255),
  "purpose" varchar(120) NOT NULL,
  "consulted_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "product_evidence_consultations_order_idx"
  ON "product_evidence_consultations" ("order_id", "consulted_at");

CREATE TABLE IF NOT EXISTS "product_dispute_defence_upload_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "defence_id" uuid NOT NULL REFERENCES "product_dispute_defences"("id"),
  "dispute_id" uuid NOT NULL REFERENCES "product_card_disputes"("id"),
  "nonce" varchar(80) NOT NULL,
  "object_key" varchar(500) NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "content_type" varchar(120) NOT NULL,
  "size_bytes" integer NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "cleaned_at" timestamp,
  "cleanup_reason" varchar(120),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_dispute_defence_upload_grants_size_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760),
  CONSTRAINT "product_dispute_defence_upload_grants_nonce_unique" UNIQUE("nonce"),
  CONSTRAINT "product_dispute_defence_upload_grants_object_key_unique" UNIQUE("object_key")
);
CREATE INDEX IF NOT EXISTS "product_dispute_defence_upload_grants_defence_expiry_idx" ON "product_dispute_defence_upload_grants" ("defence_id", "expires_at");
CREATE INDEX IF NOT EXISTS "product_dispute_defence_upload_grants_cleanup_idx" ON "product_dispute_defence_upload_grants" ("cleaned_at", "expires_at");
ALTER TABLE "product_dispute_defence_files"
  ADD COLUMN IF NOT EXISTS "upload_grant_id" uuid REFERENCES "product_dispute_defence_upload_grants"("id");

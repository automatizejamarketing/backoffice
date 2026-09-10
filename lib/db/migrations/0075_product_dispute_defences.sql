CREATE TABLE "product_dispute_defences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" uuid NOT NULL REFERENCES "product_card_disputes"("id"),
  "deadline_at" timestamp,
  "original_provider_account_id" varchar(255),
  "status" varchar NOT NULL DEFAULT 'draft',
  "reviewed_at" timestamp,
  "operator_user_id" uuid REFERENCES "users"("id"),
  "provider_submission_id" varchar(255),
  "provider_result" varchar(120),
  "submitted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "product_dispute_defences_dispute_unique" UNIQUE("dispute_id")
);
CREATE TABLE "product_dispute_defence_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "defence_id" uuid NOT NULL REFERENCES "product_dispute_defences"("id"),
  "source" varchar NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "content_type" varchar(120) NOT NULL,
  "size_bytes" integer NOT NULL,
  "storage_key" varchar(500) NOT NULL,
  "uploaded_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX "product_dispute_defence_files_defence_idx" ON "product_dispute_defence_files"("defence_id");

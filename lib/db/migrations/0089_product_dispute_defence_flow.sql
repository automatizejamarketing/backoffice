ALTER TABLE "product_dispute_defences"
  ADD COLUMN IF NOT EXISTS "expert_note" text;
ALTER TABLE "product_dispute_defences"
  ADD COLUMN IF NOT EXISTS "operator_note" text;
ALTER TABLE "product_dispute_defences"
  ADD COLUMN IF NOT EXISTS "reviewed_by_email" varchar(255);
ALTER TABLE "product_dispute_defences"
  ADD COLUMN IF NOT EXISTS "last_provider_checked_at" timestamp;
ALTER TABLE "product_dispute_defences"
  ADD COLUMN IF NOT EXISTS "last_provider_error" text;
ALTER TABLE "product_dispute_defences"
  ADD COLUMN IF NOT EXISTS "submission_lock_until" timestamp;

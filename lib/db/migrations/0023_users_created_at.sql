-- Add a signup timestamp to users. Two steps to AVOID a full table rewrite/lock:
--   1) ADD COLUMN without a default = instant (existing rows become NULL).
--   2) SET DEFAULT now() = metadata-only; applies to NEW inserts only.
-- Existing rows stay NULL (their real signup date is unknown); new signups get
-- now(). Idempotent (safe to re-run / run from both apps against the shared DB).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp;

ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT now();

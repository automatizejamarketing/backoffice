ALTER TABLE "product_refund_balance_cases"
  ALTER COLUMN "notice_sent_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_refund_balance_cases"
  ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_refund_balance_cases"
  ADD COLUMN IF NOT EXISTS "last_failure_code" varchar(120);--> statement-breakpoint
ALTER TABLE "product_refund_balance_cases"
  ADD COLUMN IF NOT EXISTS "last_failure_message" text;--> statement-breakpoint
ALTER TABLE "product_refund_balance_cases"
  ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "product_refund_balance_cases"
  ADD COLUMN IF NOT EXISTS "released_by_email" varchar(255);--> statement-breakpoint
ALTER TABLE "product_refund_balance_cases"
  ADD COLUMN IF NOT EXISTS "release_reason" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_refund_balance_cases_retry_idx"
  ON "product_refund_balance_cases" USING btree ("status", "next_retry_at");

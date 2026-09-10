-- Backoffice actors may be represented by a backoffice email rather than a
-- row in the product users table. Keep the historical FK when available, but
-- persist the actual operator, reason, and stable provider operation key for
-- every new refund attempt.
ALTER TABLE "product_refund_operations"
  ALTER COLUMN "operator_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product_refund_operations"
  ADD COLUMN IF NOT EXISTS "operator_email" varchar(255);--> statement-breakpoint
ALTER TABLE "product_refund_operations"
  ADD COLUMN IF NOT EXISTS "reason" text;

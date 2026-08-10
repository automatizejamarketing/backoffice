-- Reversal of a settled subscription payment — refund or chargeback — recorded
-- on the payment row itself, so the affiliate program can read it without
-- knowing which gateway processed the sale (ADR 0025).
--
-- `refunded_amount` is centavos and is written even when it equals the gross,
-- because the business policy is that a refund is always total: a value that
-- differs from the gross is precisely the anomaly the backoffice has to raise.
--
-- Purely additive and nullable: existing rows keep meaning "never reversed".

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "refunded_amount" integer;--> statement-breakpoint

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "refunded_at" timestamp;--> statement-breakpoint

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "reversal_kind" varchar;

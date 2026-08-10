-- Reconcile production databases where the original external-id migration was
-- skipped because their Drizzle ledger already contained a later timestamp.
-- This is intentionally idempotent so it is safe for environments where the
-- original migration already ran.

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "external_id" varchar(255);--> statement-breakpoint

UPDATE "payments"
SET "external_id" = CASE "provider"
  WHEN 'stripe' THEN "stripe_invoice_id"
  WHEN 'mercadopago' THEN "mercadopago_payment_id"
  ELSE NULL
END
WHERE "external_id" IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "payments_provider_external_id_unique"
  ON "payments" USING btree ("provider", "external_id")
  WHERE "external_id" IS NOT NULL;

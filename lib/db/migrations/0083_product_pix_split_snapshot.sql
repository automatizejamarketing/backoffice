-- Freeze the G1 quote and the amount actually reported by Mercado Pago.

ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "mercadopago_expected_provider_fee_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "mercadopago_expected_application_fee_centavos" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "mercadopago_split_contract_version" varchar(80);--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "mercadopago_application_fee_centavos" integer;

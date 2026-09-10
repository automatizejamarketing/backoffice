-- Keep the selected installment count and any provider-reported buyer interest
-- alongside the Mercado Pago card attempt. Neither field contains card data.
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "mercadopago_installments" integer;--> statement-breakpoint
ALTER TABLE "product_payments"
  ADD COLUMN IF NOT EXISTS "mercadopago_buyer_interest_centavos" integer;

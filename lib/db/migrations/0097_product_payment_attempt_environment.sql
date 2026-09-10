ALTER TABLE "product_payment_attempts"
  ADD COLUMN IF NOT EXISTS "mercadopago_environment" varchar(20);

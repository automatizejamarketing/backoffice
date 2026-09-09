ALTER TABLE "product_post_sale_cost_cases"
  ADD COLUMN IF NOT EXISTS "provider" varchar(30) NOT NULL DEFAULT 'mercadopago';
ALTER TABLE "product_post_sale_cost_cases"
  ADD COLUMN IF NOT EXISTS "provider_account_id" varchar(255);
ALTER TABLE "product_post_sale_cost_cases"
  ADD COLUMN IF NOT EXISTS "responsible" varchar(20) NOT NULL DEFAULT 'automatize';
ALTER TABLE "product_post_sale_cost_cases"
  ADD COLUMN IF NOT EXISTS "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "product_post_sale_cost_settlements"
  ALTER COLUMN "operator_user_id" DROP NOT NULL;
ALTER TABLE "product_post_sale_cost_settlements"
  ADD COLUMN IF NOT EXISTS "operator_email" varchar(255);

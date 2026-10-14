-- Plano da Agência (ADR 0046): a agência paga pelo Stripe um preço por cliente × quantidade; a
-- quantidade é o limite de clientes ligados e o "pago até" cobre o acesso das contas dos clientes.
-- Só aditivo. Shared BO 0138 / FE 0147, same `when` (1802600000000): first apply wins.

ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "plan_client_limit" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "plan_unit_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "plan_status" varchar(32) DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "plan_paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar(255);

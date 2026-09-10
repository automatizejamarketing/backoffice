-- Persist the last sanitized capability validation for the Expert receiver.

ALTER TABLE "mercado_pago_expert_connections"
  ADD COLUMN IF NOT EXISTS "last_validated_at" timestamp;--> statement-breakpoint
ALTER TABLE "mercado_pago_expert_connections"
  ADD COLUMN IF NOT EXISTS "last_validation_error" varchar(80);

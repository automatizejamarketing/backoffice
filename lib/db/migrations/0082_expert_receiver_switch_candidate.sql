-- Keep a newly authorized receiver isolated until an operator releases it.

ALTER TABLE "mercado_pago_receiver_switches"
  ALTER COLUMN "authorized_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mercado_pago_receiver_switches"
  ADD COLUMN IF NOT EXISTS "authorization_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "mercado_pago_receiver_switches"
  ADD COLUMN IF NOT EXISTS "candidate_access_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "mercado_pago_receiver_switches"
  ADD COLUMN IF NOT EXISTS "candidate_refresh_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "mercado_pago_receiver_switches"
  ADD COLUMN IF NOT EXISTS "candidate_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "mercado_pago_receiver_switches"
  ADD COLUMN IF NOT EXISTS "candidate_scopes" text;--> statement-breakpoint
ALTER TABLE "mercado_pago_receiver_switches"
  ADD COLUMN IF NOT EXISTS "candidate_pix_status" varchar(20);--> statement-breakpoint
ALTER TABLE "mercado_pago_receiver_switches"
  ADD COLUMN IF NOT EXISTS "candidate_card_status" varchar(20);--> statement-breakpoint
ALTER TABLE "mercado_pago_receiver_switches"
  ADD COLUMN IF NOT EXISTS "candidate_last_validated_at" timestamp;--> statement-breakpoint
ALTER TABLE "mercado_pago_receiver_switches"
  ADD COLUMN IF NOT EXISTS "candidate_last_validation_error" varchar(80);

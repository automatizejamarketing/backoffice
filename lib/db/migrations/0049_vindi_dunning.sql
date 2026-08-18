-- Dunning Vindi (ticket 16): tipos novos + dedup por charge.
-- Espelhado byte-a-byte no frontend como 0061_vindi_dunning, com o MESMO
-- `when` (1794100000000): quem migrar primeiro aplica; o outro pula.

ALTER TABLE "billing_notification_deliveries"
  ADD COLUMN IF NOT EXISTS "vindi_charge_id" varchar(255);--> statement-breakpoint

ALTER TABLE "billing_notification_deliveries"
  DROP CONSTRAINT IF EXISTS "billing_notification_deliveries_user_type_expiration_unique";--> statement-breakpoint

DROP INDEX IF EXISTS "billing_notification_deliveries_user_type_expiration_unique";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "billing_notification_deliveries_user_type_expiration_unique"
  ON "billing_notification_deliveries" ("user_id", "notification_type", "expiration_date", "channel")
  WHERE "vindi_charge_id" IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "billing_notification_deliveries_vindi_charge_type_channel_unique"
  ON "billing_notification_deliveries" ("vindi_charge_id", "notification_type", "channel")
  WHERE "vindi_charge_id" IS NOT NULL;

-- Dunning Vindi (ticket 16): tipos novos + dedup por charge.
--
-- Gêmea de `backoffice/0049_vindi_dunning` e `frontend/0064_vindi_dunning`, com
-- o MESMO `when` (1794590000000). A marca d'água de `drizzle.__drizzle_migrations`
-- é compartilhada pelos dois repositórios: quem migrar primeiro aplica e o outro
-- pula, o que só é seguro porque o DDL é o mesmo.
--
-- Por isso os dois arquivos precisam ter conteúdo IDÊNTICO, comentários inclusive:
-- a auditoria (`tests/migration-journal.test.ts`) libera o `when` repetido apenas
-- quando os hashes batem. Se divergirem, o teste acusa — e, na vida real, um dos
-- dois DDLs jamais roda. Editou um, edite o outro com o mesmo texto.
--
-- Aditivo, e acima da marca de 0048_vindi_expand / 0063_vindi_registry_code.

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

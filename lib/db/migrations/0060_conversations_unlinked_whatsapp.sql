-- WhatsApp closer threads (unlinked numbers) cannot use users.id.
-- Same pattern as Chatwoot 0058: nullable user_id + unique phone for the channel.
--
-- This file is byte-identical to
-- backoffice/lib/db/migrations/0060_conversations_unlinked_whatsapp.sql
-- so a single sha256 covers both journals in the shared drizzle.__drizzle_migrations.

ALTER TABLE "conversations"
  ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations"
  ADD COLUMN IF NOT EXISTS "phone_e164" varchar(20);
--> statement-breakpoint
DROP INDEX IF EXISTS "conversations_whatsapp_user_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_whatsapp_user_unique"
  ON "conversations" ("user_id")
  WHERE "channel" = 'whatsapp' AND "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_whatsapp_phone_unique"
  ON "conversations" ("phone_e164")
  WHERE "channel" = 'whatsapp' AND "phone_e164" IS NOT NULL;

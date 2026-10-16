-- One WhatsApp number may be linked to more than one account.
-- The inbound thread still has one active account per moment.
-- Shared FE 0130 / BO 0123, same `when` (1801100000000): first apply wins.

DROP INDEX IF EXISTS "whatsapp_links_phone_e164_unique";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_links_active_user_unique"
  ON "whatsapp_links" ("user_id")
  WHERE "status" IN ('pending', 'linked');--> statement-breakpoint

DROP INDEX IF EXISTS "conversations_whatsapp_phone_unique";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_whatsapp_phone_unique"
  ON "conversations" ("phone_e164")
  WHERE "channel" = 'whatsapp' AND "phone_e164" IS NOT NULL AND "user_id" IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "whatsapp_account_choices" (
  "phone_e164" varchar(20) PRIMARY KEY NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "session_moment" integer DEFAULT 1 NOT NULL,
  "last_activity_at" timestamp,
  "pending_text" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

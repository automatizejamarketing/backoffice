-- Mat conversation history: an append-only log of Eve channel events.
-- See automatize-frontend/docs/adr/0018-mat-conversation-history-as-channel-event-log.md
--
-- IMPORTANT: "conversations"."user_id" carries NO ON DELETE CASCADE, on purpose.
-- A conversation is a permanent record; the FK is the database-level guard that
-- stops any flow from erasing a user who has one. Only the ops script
-- automatize-frontend/scripts/delete-user.ts may clear conversations, and it does
-- so explicitly, together with the user.
--
-- This file is byte-identical to backoffice/lib/db/migrations/0025_conversations.sql
-- so a single sha256 covers both journals in the shared drizzle.__drizzle_migrations.

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "channel" varchar(16) NOT NULL,
  "eve_session_id" text,
  "title" text,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "last_event_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_user_id_last_event_at_idx"
  ON "conversations" ("user_id","last_event_at");
--> statement-breakpoint
-- web: one conversation per Eve session (widget open -> close).
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_web_session_unique"
  ON "conversations" ("eve_session_id")
  WHERE "channel" = 'web';
--> statement-breakpoint
-- whatsapp: one continuous thread per user -- no invented boundaries.
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_whatsapp_user_unique"
  ON "conversations" ("user_id")
  WHERE "channel" = 'whatsapp';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_events" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "turn_id" text,
  "seq" integer,
  "type" varchar(48) NOT NULL,
  "payload" jsonb NOT NULL,
  "truncated" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_events_conversation_id_id_idx"
  ON "conversation_events" ("conversation_id","id");

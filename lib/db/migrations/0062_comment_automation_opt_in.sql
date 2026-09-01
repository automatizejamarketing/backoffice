-- Automação de Comentário→DM (ticket 06, dois saltos / Opt-in).
--
-- Gêmea de `backoffice/0062_comment_automation_opt_in` e
-- `frontend/0068_comment_automation_opt_in`, com o MESMO `when` (1794710000000).
-- A marca d'água de `drizzle.__drizzle_migrations` é compartilhada: quem
-- migrar primeiro aplica e o outro pula, o que só é seguro porque o DDL é
-- o mesmo. Os dois arquivos precisam ser IDÊNTICOS, comentários inclusive.
--
-- Aditivo e idempotente. Recria o DDL dos tickets 03/04 com IF NOT EXISTS
-- (o backoffice em main ainda não tinha essas tabelas) e acrescenta
-- Opt-in / Entrega.
-- Acima da marca de frontend/0067 (1794680000000) e backoffice/0061.

ALTER TABLE "instagram_accounts"
  ADD COLUMN IF NOT EXISTS "needs_reconnect_at" timestamp;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "instagram_webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "field" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "dedupe_key" varchar(255) NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "instagram_webhook_events_dedupe_key_unique" UNIQUE("dedupe_key")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "instagram_webhook_events_received_at_idx"
  ON "instagram_webhook_events" ("received_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "instagram_comment_automations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "instagram_account_id" text NOT NULL,
  "post_selector" varchar(32) DEFAULT 'specific' NOT NULL,
  "target_media_id" text NOT NULL,
  "target_permalink" text,
  "target_caption" text,
  "target_thumbnail_url" text,
  "comment_match" jsonb NOT NULL,
  "public_replies" jsonb NOT NULL,
  "opening_dm" jsonb NOT NULL,
  "delivery_dm" jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'draft' NOT NULL,
  "suspension_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "instagram_comment_automations_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
  CONSTRAINT "instagram_comment_automations_account_id_fk"
    FOREIGN KEY ("instagram_account_id") REFERENCES "public"."instagram_accounts"("id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "instagram_comment_automations_user_id_idx"
  ON "instagram_comment_automations" ("user_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "instagram_comment_automations_account_status_idx"
  ON "instagram_comment_automations" ("instagram_account_id", "status");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "instagram_comment_automations_one_active_media"
  ON "instagram_comment_automations" ("instagram_account_id", "target_media_id")
  WHERE "status" = 'active';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "instagram_comment_automation_claims" (
  "media_id" text NOT NULL,
  "commenter_igsid" text NOT NULL,
  "claimed_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "instagram_comment_automation_claims_pk"
    PRIMARY KEY ("media_id", "commenter_igsid")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "instagram_comment_automation_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "automation_id" uuid NOT NULL,
  "comment_id" text NOT NULL,
  "commenter_igsid" text NOT NULL,
  "commenter_username" text,
  "media_id" text NOT NULL,
  "matched_at" timestamp,
  "public_reply_sent_at" timestamp,
  "public_reply_text" text,
  "private_reply_sent_at" timestamp,
  "opted_in_at" timestamp,
  "delivery_sent_at" timestamp,
  "failed_at" timestamp,
  "failure_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "instagram_comment_automation_executions_comment_id_unique"
    UNIQUE("comment_id"),
  CONSTRAINT "instagram_comment_automation_executions_automation_id_fk"
    FOREIGN KEY ("automation_id") REFERENCES "public"."instagram_comment_automations"("id")
);--> statement-breakpoint

ALTER TABLE "instagram_comment_automation_executions"
  ADD COLUMN IF NOT EXISTS "opted_in_at" timestamp;--> statement-breakpoint

ALTER TABLE "instagram_comment_automation_executions"
  ADD COLUMN IF NOT EXISTS "delivery_sent_at" timestamp;--> statement-breakpoint

UPDATE "instagram_comment_automation_executions"
SET "delivery_sent_at" = "private_reply_sent_at"
WHERE "delivery_sent_at" IS NULL
  AND "private_reply_sent_at" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "instagram_comment_automation_executions_automation_idx"
  ON "instagram_comment_automation_executions" ("automation_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "instagram_comment_automation_executions_commenter_idx"
  ON "instagram_comment_automation_executions" ("commenter_igsid");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "instagram_comment_automation_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "comment_id" text NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp DEFAULT now() NOT NULL,
  "last_error" text,
  "payload" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "instagram_comment_automation_jobs_comment_id_unique"
    UNIQUE("comment_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "instagram_comment_automation_jobs_due_idx"
  ON "instagram_comment_automation_jobs" ("status", "next_attempt_at");

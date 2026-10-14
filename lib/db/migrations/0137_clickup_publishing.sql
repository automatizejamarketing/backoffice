-- Postagem pelo ClickUp (ADR 0043/0045): conexão OAuth por agência com o mapeamento da Lista de
-- Publicação, eventos do webhook (dedupe por webhook:item do histórico), a ligação tarefa →
-- agendamento e a fila de escritas de volta na tarefa (Retorno na Tarefa). Só aditivo.
-- Shared BO 0137 / FE 0146, same `when` (1802500000000): first apply wins.

CREATE TABLE IF NOT EXISTS "clickup_connections" (
  "agency_id" uuid PRIMARY KEY NOT NULL REFERENCES "agencies"("id"),
  "access_token_encrypted" text NOT NULL,
  "clickup_user_id" varchar(32) NOT NULL,
  "clickup_user_email" varchar(200),
  "team_id" varchar(32),
  "team_name" text,
  "mapping" jsonb,
  "webhook_id" varchar(64),
  "webhook_secret_encrypted" text,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "status_detail" text,
  "connected_by_email" varchar(100) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "clickup_webhook_events" (
  "id" varchar(160) PRIMARY KEY NOT NULL,
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id"),
  "task_id" varchar(32) NOT NULL,
  "intent" varchar(16) NOT NULL,
  "actor_clickup_user_id" varchar(32),
  "to_status" varchar(100),
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone,
  "processed_at" timestamp with time zone,
  "result" text
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "clickup_webhook_events_pending_idx" ON "clickup_webhook_events" USING btree ("received_at") WHERE "processed_at" IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "clickup_task_posts" (
  "task_id" varchar(32) PRIMARY KEY NOT NULL,
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "scheduled_post_id" uuid REFERENCES "scheduled_posts"("id") ON DELETE SET NULL,
  "state" varchar(16) NOT NULL,
  "reported_state" varchar(16),
  "approved_by_clickup_user_id" varchar(32),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "clickup_task_posts_scheduled_post_idx" ON "clickup_task_posts" USING btree ("scheduled_post_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "clickup_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id"),
  "task_id" varchar(32) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "dedupe_key" varchar(200) NOT NULL UNIQUE,
  "body" text NOT NULL,
  "mention_clickup_user_id" varchar(32),
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "clickup_outbox_pending_idx" ON "clickup_outbox" USING btree ("next_attempt_at") WHERE "sent_at" IS NULL;

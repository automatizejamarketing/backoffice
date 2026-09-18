-- Relatório de Valor: snapshots imutáveis, marcos, preferências, benchmarks e missões.
-- Shared FE 0073 / BO 0066, same `when` (1795100000000): first apply wins.

CREATE TABLE IF NOT EXISTS "client_report_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "period_type" varchar(16) NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" varchar(16) DEFAULT 'built' NOT NULL,
  "headline_state" varchar(16) NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "months_paid_back" numeric,
  "is_personal_best" boolean DEFAULT false NOT NULL,
  "built_at" timestamp DEFAULT now() NOT NULL,
  "delivered_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "client_report_snapshots_user_period_unique"
  ON "client_report_snapshots" ("user_id", "period_type", "period_start");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_report_snapshots_user_built_idx"
  ON "client_report_snapshots" ("user_id", "built_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_report_snapshots_status_idx"
  ON "client_report_snapshots" ("status", "period_type");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_report_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "milestone_key" varchar(80) NOT NULL,
  "value" numeric,
  "snapshot_id" uuid REFERENCES "client_report_snapshots"("id"),
  "reached_at" timestamp DEFAULT now() NOT NULL,
  "delivered_at" timestamp
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "client_report_milestones_user_key_unique"
  ON "client_report_milestones" ("user_id", "milestone_key");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_report_milestones_undelivered_idx"
  ON "client_report_milestones" ("user_id", "delivered_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_report_preferences" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id"),
  "digest_frequency" varchar(16) DEFAULT 'weekly' NOT NULL,
  "day_of_week" integer DEFAULT 1 NOT NULL,
  "hour" integer DEFAULT 9 NOT NULL,
  "timezone" varchar(64) DEFAULT 'America/Sao_Paulo' NOT NULL,
  "whatsapp_enabled" boolean DEFAULT true NOT NULL,
  "milestones_enabled" boolean DEFAULT true NOT NULL,
  "renewal_recap_enabled" boolean DEFAULT true NOT NULL,
  "pause_requested_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_report_benchmarks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "spend_bucket" varchar(32) NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "sample_size" integer NOT NULL,
  "roas_p25" numeric,
  "roas_p50" numeric,
  "roas_p75" numeric,
  "cpa_p25" numeric,
  "cpa_p50" numeric,
  "cpa_p75" numeric,
  "computed_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "client_report_benchmarks_bucket_period_unique"
  ON "client_report_benchmarks" ("spend_bucket", "period_start");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_report_missions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "snapshot_id" uuid REFERENCES "client_report_snapshots"("id"),
  "title" text NOT NULL,
  "message" text,
  "action_prompt" text,
  "deep_link" text,
  "status" varchar(16) DEFAULT 'suggested' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_report_missions_user_status_idx"
  ON "client_report_missions" ("user_id", "status");

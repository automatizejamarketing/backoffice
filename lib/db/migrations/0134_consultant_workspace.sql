-- Área de Tráfego do consultor: metas, linha do tempo, passagem de bastão do
-- onboarding, tags de problema e análise de IA por cliente, mais o resultado
-- e o adiamento de alertas em performance_insights. Só aditivo.
-- Shared BO 0134 / FE 0143, same `when` (1802100000000): first apply wins.

CREATE TABLE IF NOT EXISTS "consultant_client_goals" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kpi" varchar(24) NOT NULL,
  "target" numeric NOT NULL,
  "monthly_budget" numeric,
  "updated_by_email" varchar(100) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "consultant_client_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" varchar(16) NOT NULL,
  "body" text NOT NULL,
  "metadata" jsonb,
  "author_email" varchar(100) NOT NULL,
  "source" varchar(16) DEFAULT 'backoffice' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "consultant_client_notes_user_created_idx"
  ON "consultant_client_notes" USING btree ("user_id", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "consultant_onboarding_handoffs" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "summary" text NOT NULL,
  "next_steps" text DEFAULT '' NOT NULL,
  "call_date" date,
  "author_email" varchar(100) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "consultant_client_problem_tags" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tag_key" varchar(40) NOT NULL,
  "state" varchar(16) NOT NULL,
  "updated_by_email" varchar(100) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "consultant_client_problem_tags_user_id_tag_key_pk" PRIMARY KEY ("user_id", "tag_key")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "consultant_client_ai_analyses" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "model" varchar(80) NOT NULL,
  "period_days" integer NOT NULL,
  "generated_by_email" varchar(100) NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "performance_insights" ADD COLUMN IF NOT EXISTS "review_outcome" varchar(32);--> statement-breakpoint

ALTER TABLE "performance_insights" ADD COLUMN IF NOT EXISTS "snoozed_until" timestamp;

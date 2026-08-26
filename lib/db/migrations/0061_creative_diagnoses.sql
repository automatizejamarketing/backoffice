-- Diagnóstico de criativo contra o rubric destilado do Ranking do Dia.
--
-- Estritamente aditiva: uma CREATE TABLE nova, nenhum ALTER, nenhum DROP.
-- O banco é compartilhado com o backoffice; os dois journals registram esta
-- migration com o MESMO `when` para o migrador pular a segunda aplicação.

CREATE TABLE IF NOT EXISTS "creative_diagnoses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" text NOT NULL,
  "ad_id" text NOT NULL,
  "creative_id" text NOT NULL,
  "campaign_id" text,
  "adset_id" text,
  "cache_key" text NOT NULL,
  "ranking_run_id" uuid,
  "ranking_date" date,
  "rubric_version" text NOT NULL,
  "model_id" text NOT NULL,
  "metric_window_start" date NOT NULL,
  "metric_window_end" date NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "diagnosis" jsonb,
  "confidence" varchar(16),
  "likely_contributor" boolean,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "error_message" text,
  "usage" jsonb,
  "media_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "creative_diagnoses_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
  CONSTRAINT "creative_diagnoses_ranking_run_id_fk"
    FOREIGN KEY ("ranking_run_id") REFERENCES "public"."winning_creative_ranking_runs"("id")
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "creative_diagnoses_cache_key_unique"
  ON "creative_diagnoses" ("cache_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "creative_diagnoses_user_ad_idx"
  ON "creative_diagnoses" ("user_id", "ad_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "creative_diagnoses_account_status_idx"
  ON "creative_diagnoses" ("account_id", "status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "creative_diagnoses_ranking_run_idx"
  ON "creative_diagnoses" ("ranking_run_id");

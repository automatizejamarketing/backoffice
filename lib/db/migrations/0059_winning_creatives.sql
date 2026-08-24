-- Ranking do Dia / Criativos Vencedores — fatia de schema + motor de seleção.
--
-- Estritamente aditiva: duas CREATE TABLE novas, nenhum ALTER, nenhum DROP.
-- O banco é compartilhado com o backoffice; os dois journals registram esta
-- migration com o MESMO `when` para o migrador pular a segunda aplicação.

CREATE TABLE IF NOT EXISTS "winning_creative_ranking_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ranking_date" date NOT NULL,
  "status" varchar(16) DEFAULT 'building' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "winning_creative_ranking_runs_date_status_idx"
  ON "winning_creative_ranking_runs" ("ranking_date", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "winning_creatives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "creative_id" text NOT NULL,
  "advertiser_company_id" uuid NOT NULL,
  "sub_niche" varchar(32) NOT NULL,
  "format" varchar(16) NOT NULL,
  "aspect_ratio" varchar(16),
  "medias" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "headline" text,
  "primary_text" text,
  "cta" text,
  "first_delivered_on" date NOT NULL,
  "position" integer NOT NULL,
  "aggregated_roas" numeric,
  "aggregated_spend" numeric,
  "analysis" jsonb,
  "analysis_status" varchar(16) DEFAULT 'pending' NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "archived_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "winning_creatives_run_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."winning_creative_ranking_runs"("id"),
  CONSTRAINT "winning_creatives_advertiser_company_id_fk"
    FOREIGN KEY ("advertiser_company_id") REFERENCES "public"."companies"("id")
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "winning_creatives_run_position_unique"
  ON "winning_creatives" ("run_id", "position");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "winning_creatives_run_creative_unique"
  ON "winning_creatives" ("run_id", "creative_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "winning_creatives_run_idx"
  ON "winning_creatives" ("run_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "winning_creatives_company_idx"
  ON "winning_creatives" ("advertiser_company_id");

-- Fundação de tracking de campanhas Meta — fase F1 do plano
-- `backoffice/docs/plans/campaign-tracking-foundation.md`.
--
-- Estritamente aditiva: sete CREATE TABLE novos, nenhum ALTER, nenhum DROP.
-- Nenhuma tabela ou coluna existente é tocada — as tabelas legadas de edit log
-- (`campaign_edit_logs`, `adset_edit_logs`, `ad_creative_edit_logs`) continuam
-- recebendo dual-write e ganham apenas uma ponte de referência a partir de
-- `meta_tracking_change_events.legacy_edit_log_*`.
--
-- O banco é compartilhado entre `backoffice` e `automatize-frontend`, e os dois
-- journals registram esta migration com o MESMO `when`: quem rodar primeiro
-- aplica, o outro pula (o migrador compara `created_at`). Por isso ela é
-- idempotente ponta a ponta (`IF NOT EXISTS` em tudo).
--
-- Por que três formatos e não um: configuração muda raramente (versões SCD2),
-- resultado muda todo dia e ainda é reescrito retroativamente por 28 dias
-- (série com upsert), e ação é um fato pontual que precisa de autor e motivo
-- (stream). Guardar os três do mesmo jeito perderia o que cada um tem de
-- próprio.

-- Execuções de coleta. Uma linha por invocação do cron, não por dia: o cron
-- dispara várias vezes na madrugada drenando lotes.
CREATE TABLE IF NOT EXISTS "meta_tracking_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" varchar(16) DEFAULT 'daily' NOT NULL,
  "triggered_by" varchar(16) DEFAULT 'cron' NOT NULL,
  "status" varchar(24) DEFAULT 'running' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "error_message" text,
  "summary" jsonb DEFAULT '{"eventsCreated": 0, "entitiesSeen": 0, "accountsCovered": 0, "accountsSkipped": 0, "versionsCreated": 0, "metricRowsUpserted": 0}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "meta_tracking_runs_started_at_idx"
  ON "meta_tracking_runs" ("started_at");

CREATE INDEX IF NOT EXISTS "meta_tracking_runs_status_idx"
  ON "meta_tracking_runs" ("status");

CREATE INDEX IF NOT EXISTS "meta_tracking_runs_kind_started_at_idx"
  ON "meta_tracking_runs" ("kind", "started_at");

-- Cobertura por conta × dia. É o mecanismo de claim (conta sem cobertura
-- `complete` hoje = pendente) e a fonte da tela de operação. Moeda e timezone
-- da conta ficam aqui, não por linha de métrica.
CREATE TABLE IF NOT EXISTS "meta_tracking_account_coverage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" text NOT NULL,
  "business_date" date NOT NULL,
  "status" varchar(24) NOT NULL,
  "error_message" text,
  "entities_seen" integer DEFAULT 0 NOT NULL,
  "api_calls_used" integer DEFAULT 0 NOT NULL,
  "currency" varchar(8),
  "timezone_name" varchar(64),
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "meta_tracking_account_coverage_run_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."meta_tracking_runs"("id"),
  CONSTRAINT "meta_tracking_account_coverage_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "meta_tracking_account_coverage_account_date_unique"
  ON "meta_tracking_account_coverage" ("account_id", "business_date");

CREATE INDEX IF NOT EXISTS "meta_tracking_account_coverage_date_status_idx"
  ON "meta_tracking_account_coverage" ("business_date", "status");

CREATE INDEX IF NOT EXISTS "meta_tracking_account_coverage_run_idx"
  ON "meta_tracking_account_coverage" ("run_id");

CREATE INDEX IF NOT EXISTS "meta_tracking_account_coverage_user_date_idx"
  ON "meta_tracking_account_coverage" ("user_id", "business_date");

-- Eventos crus do audit trail da Meta (`/act_{id}/activities`). Persistidos
-- inteiros, inclusive os sem match (billing, públicos, papéis da conta).
--
-- `dedup_hash` = sha256 de (account_id, event_type, event_time, object_id,
-- actor_id). Hash, e não unique composto, porque `object_id` e `actor_id` vêm
-- nulos em parte dos eventos e no Postgres NULL não colide com NULL — o unique
-- composto deixaria passar duplicata justo na sobreposição de 48 h do poll.
CREATE TABLE IF NOT EXISTS "meta_tracking_activity_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" text NOT NULL,
  "event_type" varchar(64) NOT NULL,
  "translated_event_type" text,
  "event_time" timestamp NOT NULL,
  "actor_id" text,
  "actor_name" text,
  "application_id" text,
  "object_id" text,
  "object_type" varchar(48),
  "object_name" text,
  "extra_data" jsonb,
  "dedup_hash" varchar(64) NOT NULL,
  "matched_change_event_id" uuid,
  "fetched_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "meta_tracking_activity_events_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "meta_tracking_activity_events_dedup_hash_unique"
  ON "meta_tracking_activity_events" ("dedup_hash");

CREATE INDEX IF NOT EXISTS "meta_tracking_activity_events_account_time_idx"
  ON "meta_tracking_activity_events" ("account_id", "event_time");

CREATE INDEX IF NOT EXISTS "meta_tracking_activity_events_object_idx"
  ON "meta_tracking_activity_events" ("object_id");

-- Versões de configuração (SCD tipo 2). Versão nova só quando a configuração
-- muda de fato; "estado em qualquer data" é consulta de vigência.
--
-- CAMPOS VOLÁTEIS — GRAVADOS, MAS FORA DO HASH: `effective_status`,
-- `budget_remaining`, `learning_stage_info`, `issues_info`, `updated_time_meta`
-- e `last_budget_toggling_time` não entram em `config_hash` e não abrem versão.
-- Eles mudam sozinhos (cascata de pausa do pai, gasto do dia, fase de
-- aprendizado); no hash, toda entidade ganharia versão nova todo dia e o
-- histórico de configuração viraria ruído. Transição de estado vira evento em
-- `meta_tracking_change_events`, não versão.
CREATE TABLE IF NOT EXISTS "meta_tracking_config_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" text NOT NULL,
  "entity_level" varchar(16) NOT NULL,
  "entity_id" text NOT NULL,
  "campaign_id" text,
  "adset_id" text,
  "entity_name" text,
  "valid_from" timestamp DEFAULT now() NOT NULL,
  "valid_to" timestamp,
  "version_number" integer DEFAULT 1 NOT NULL,
  "first_seen_run_id" uuid,
  "last_confirmed_at" timestamp DEFAULT now() NOT NULL,
  "config_hash" varchar(64) NOT NULL,
  "config" jsonb NOT NULL,
  "is_managed" boolean DEFAULT false NOT NULL,
  "configured_status" varchar(24),
  "created_time_meta" timestamp,
  "objective" varchar(48),
  "buying_type" varchar(24),
  "bid_strategy" varchar(48),
  "spend_cap" numeric,
  "special_ad_categories" jsonb,
  "smart_promotion_type" varchar(48),
  "advantage_state" varchar(48),
  "is_adset_budget_sharing_enabled" boolean,
  "budget_mode" varchar(8),
  "daily_budget" numeric,
  "lifetime_budget" numeric,
  "optimization_goal" varchar(48),
  "billing_event" varchar(48),
  "bid_amount" numeric,
  "destination_type" varchar(48),
  "start_time" timestamp,
  "end_time" timestamp,
  "is_dynamic_creative" boolean,
  "targeting" jsonb,
  "promoted_object" jsonb,
  "attribution_spec" jsonb,
  "frequency_control_specs" jsonb,
  "pacing_type" jsonb,
  "dsa_beneficiary" text,
  "dsa_payor" text,
  "creative_id" text,
  "conversion_domain" text,
  "tracking_specs" jsonb,
  "effective_status" varchar(32),
  "budget_remaining" numeric,
  "learning_stage_info" jsonb,
  "issues_info" jsonb,
  "updated_time_meta" timestamp,
  "last_budget_toggling_time" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "meta_tracking_config_versions_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
  CONSTRAINT "meta_tracking_config_versions_first_seen_run_id_fk"
    FOREIGN KEY ("first_seen_run_id") REFERENCES "public"."meta_tracking_runs"("id")
);

-- Reexecutar a coleta no mesmo dia reencontra a linha em vez de duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS "meta_tracking_config_versions_entity_hash_valid_from_unique"
  ON "meta_tracking_config_versions" ("entity_level", "entity_id", "config_hash", "valid_from");

-- Versão vigente: o caminho de leitura de "estado em qualquer data".
CREATE INDEX IF NOT EXISTS "meta_tracking_config_versions_current_idx"
  ON "meta_tracking_config_versions" ("entity_level", "entity_id")
  WHERE "valid_to" is null;

CREATE INDEX IF NOT EXISTS "meta_tracking_config_versions_account_valid_from_idx"
  ON "meta_tracking_config_versions" ("account_id", "valid_from");

CREATE INDEX IF NOT EXISTS "meta_tracking_config_versions_user_idx"
  ON "meta_tracking_config_versions" ("user_id");

-- Stream unificado de ações. `note` (motivo) é obrigatório na APLICAÇÃO quando
-- `source = 'backoffice_admin'`, não no banco: o mesmo evento vindo do coletor
-- (`external_detected`) legitimamente não tem motivo, porque ninguém o
-- declarou.
CREATE TABLE IF NOT EXISTS "meta_tracking_change_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" text NOT NULL,
  "entity_level" varchar(16) NOT NULL,
  "entity_id" text NOT NULL,
  "campaign_id" text,
  "adset_id" text,
  "entity_name" text,
  "change_kind" varchar(24) NOT NULL,
  "changed_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "from_config_version_id" uuid,
  "to_config_version_id" uuid,
  "source" varchar(24) NOT NULL,
  "actor_email" varchar(100),
  "actor_name_meta" text,
  "note" text,
  "occurred_at" timestamp NOT NULL,
  "detected_at" timestamp DEFAULT now() NOT NULL,
  "detection_run_id" uuid,
  "activity_event_id" uuid,
  "legacy_edit_log_table" varchar(32),
  "legacy_edit_log_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "meta_tracking_change_events_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
  CONSTRAINT "meta_tracking_change_events_from_config_version_id_fk"
    FOREIGN KEY ("from_config_version_id") REFERENCES "public"."meta_tracking_config_versions"("id"),
  CONSTRAINT "meta_tracking_change_events_to_config_version_id_fk"
    FOREIGN KEY ("to_config_version_id") REFERENCES "public"."meta_tracking_config_versions"("id"),
  CONSTRAINT "meta_tracking_change_events_detection_run_id_fk"
    FOREIGN KEY ("detection_run_id") REFERENCES "public"."meta_tracking_runs"("id"),
  CONSTRAINT "meta_tracking_change_events_activity_event_id_fk"
    FOREIGN KEY ("activity_event_id") REFERENCES "public"."meta_tracking_activity_events"("id")
);

CREATE INDEX IF NOT EXISTS "meta_tracking_change_events_entity_occurred_idx"
  ON "meta_tracking_change_events" ("entity_level", "entity_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "meta_tracking_change_events_account_occurred_idx"
  ON "meta_tracking_change_events" ("account_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "meta_tracking_change_events_user_occurred_idx"
  ON "meta_tracking_change_events" ("user_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "meta_tracking_change_events_source_idx"
  ON "meta_tracking_change_events" ("source");

-- Série diária de resultados: uma linha por entidade × dia, sempre. Janela de
-- análise é consulta, nunca armazenamento. Upsert da janela móvel de 28 dias
-- (os insights da Meta mudam retroativamente até congelar); nunca deletar.
CREATE TABLE IF NOT EXISTS "meta_tracking_daily_metrics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" text NOT NULL,
  "entity_level" varchar(16) NOT NULL,
  "entity_id" text NOT NULL,
  "campaign_id" text,
  "adset_id" text,
  "metric_date" date NOT NULL,
  "spend" numeric,
  "impressions" integer,
  "clicks" integer,
  "reach" integer,
  "frequency" numeric,
  "actions" jsonb,
  "action_values" jsonb,
  "cost_per_action_type" jsonb,
  "cost_per_result" jsonb,
  "purchase_roas" jsonb,
  "website_purchase_roas" jsonb,
  "first_captured_at" timestamp DEFAULT now() NOT NULL,
  "last_refreshed_at" timestamp DEFAULT now() NOT NULL,
  "is_final" boolean DEFAULT false NOT NULL,
  CONSTRAINT "meta_tracking_daily_metrics_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "meta_tracking_daily_metrics_entity_date_unique"
  ON "meta_tracking_daily_metrics" ("entity_level", "entity_id", "metric_date");

CREATE INDEX IF NOT EXISTS "meta_tracking_daily_metrics_account_date_idx"
  ON "meta_tracking_daily_metrics" ("account_id", "metric_date");

CREATE INDEX IF NOT EXISTS "meta_tracking_daily_metrics_campaign_date_idx"
  ON "meta_tracking_daily_metrics" ("campaign_id", "metric_date");

CREATE INDEX IF NOT EXISTS "meta_tracking_daily_metrics_user_date_idx"
  ON "meta_tracking_daily_metrics" ("user_id", "metric_date");

-- Snapshot de criativo, chaveado pelo id da própria Meta: criativos são
-- imutáveis na prática (sem `updated_time` documentado), então uma linha basta.
CREATE TABLE IF NOT EXISTS "meta_tracking_creatives" (
  "id" text PRIMARY KEY NOT NULL,
  "account_id" text NOT NULL,
  "spec" jsonb NOT NULL,
  "fetched_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "meta_tracking_creatives_account_idx"
  ON "meta_tracking_creatives" ("account_id");

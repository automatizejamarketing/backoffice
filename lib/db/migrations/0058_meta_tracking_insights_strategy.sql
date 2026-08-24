-- Estratégia adaptativa do Insights por conta × nível.
--
-- Só níveis que já precisaram de fallback têm linha aqui. Ausência continua
-- significando o caminho padrão (sync pela janela inteira), sem povoar a tabela
-- para contas pequenas. A persistência é durável porque memória de processo não
-- sobrevive de forma confiável entre os dias/cold starts do cron serverless.
CREATE TABLE IF NOT EXISTS "meta_tracking_insights_strategies" (
  "account_id" text NOT NULL,
  "entity_level" varchar(16) NOT NULL,
  "mode" varchar(16) NOT NULL,
  "max_range_days" integer,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "meta_tracking_insights_strategies_pk"
    PRIMARY KEY ("account_id", "entity_level"),
  CONSTRAINT "meta_tracking_insights_strategies_entity_level_check"
    CHECK ("entity_level" IN ('campaign', 'adset', 'ad')),
  CONSTRAINT "meta_tracking_insights_strategies_shape_check"
    CHECK (
      (
        "mode" = 'sync'
        AND "max_range_days" IS NOT NULL
        AND "max_range_days" >= 1
      )
      OR ("mode" = 'async' AND "max_range_days" IS NULL)
    )
);

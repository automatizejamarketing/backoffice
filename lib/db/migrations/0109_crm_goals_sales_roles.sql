-- Metas do time comercial e cargo comercial.
--
-- `crm_goals`: uma linha por (mês, métrica) só quando o gestor muda a meta;
-- meses sem linha herdam a linha anterior mais recente. `target` NULL = a
-- métrica passa a não ter meta a partir daquele mês.
--
-- `backoffice_users.sales_role`: cargo comercial (gestor_comercial, sdr,
-- consultor_comercial). É rótulo de quem responde por cada meta; o papel de
-- acesso continua em `role` (que ganha o valor `comercial`, sem DDL: a coluna
-- é varchar sem CHECK).
--
-- Idempotente: pode rodar de novo sem efeito.

CREATE TABLE IF NOT EXISTS "crm_goals" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "month" date NOT NULL,
  "metric" varchar(32) NOT NULL,
  "target" integer,
  "updated_by" varchar(100) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "crm_goals_month_metric_unique" ON "crm_goals" ("month", "metric");
--> statement-breakpoint
ALTER TABLE "backoffice_users" ADD COLUMN IF NOT EXISTS "sales_role" varchar(32);

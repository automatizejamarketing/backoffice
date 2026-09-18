-- Relatórios por período e por campanha, mantendo snapshots imutáveis por escopo.

ALTER TABLE "client_report_snapshots"
  ADD COLUMN IF NOT EXISTS "scope_type" varchar(16) DEFAULT 'account' NOT NULL,
  ADD COLUMN IF NOT EXISTS "campaign_id" text,
  ADD COLUMN IF NOT EXISTS "generated_by" varchar(16) DEFAULT 'automatic' NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "client_report_snapshots_user_period_unique";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "client_report_snapshots_account_period_unique"
  ON "client_report_snapshots" ("user_id", "period_type", "period_start")
  WHERE "campaign_id" IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "client_report_snapshots_campaign_period_unique"
  ON "client_report_snapshots" ("user_id", "period_type", "period_start", "campaign_id")
  WHERE "campaign_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "client_report_snapshots_campaign_idx"
  ON "client_report_snapshots" ("user_id", "campaign_id", "period_start");--> statement-breakpoint

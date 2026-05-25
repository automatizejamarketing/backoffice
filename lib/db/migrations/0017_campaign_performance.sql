-- Marketing campaign-performance feature (shared with automatize-frontend).
-- Idempotent so it is safe regardless of which app's migration runs first against
-- the shared Postgres. Mirrors automatize-frontend migration 0013.

CREATE TABLE IF NOT EXISTS "campaign_performance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"metric" varchar(40) NOT NULL,
	"operator" varchar(8) NOT NULL,
	"threshold" numeric(14, 4) NOT NULL,
	"description" text,
	"updated_by_email" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ad_account_id" text NOT NULL,
	"ad_account_name" text,
	"campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"objective" text,
	"spend" numeric(14, 2),
	"revenue" numeric(14, 2),
	"purchase_roas" numeric(12, 4),
	"purchase_count" integer,
	"impressions" integer,
	"clicks" integer,
	"currency" varchar(8),
	"metrics" jsonb,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "campaign_performance_snapshots" ADD CONSTRAINT "campaign_performance_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_performance_snapshots_user_campaign_period_unique" ON "campaign_performance_snapshots" ("user_id","campaign_id","period_start","period_end");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_performance_snapshots_user_id_idx" ON "campaign_performance_snapshots" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_performance_snapshots_user_period_idx" ON "campaign_performance_snapshots" ("user_id","period_end");
--> statement-breakpoint
INSERT INTO "campaign_performance_rules" ("name","enabled","metric","operator","threshold","description")
SELECT 'ROAS mínimo', true, 'roas', 'gt', 2, 'Regra inicial de teste: ROAS acima de 2.'
WHERE NOT EXISTS (SELECT 1 FROM "campaign_performance_rules");

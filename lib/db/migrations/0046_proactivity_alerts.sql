CREATE TABLE IF NOT EXISTS "proactivity_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_key" varchar(64) NOT NULL,
	"audience" varchar(16) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deliver_whatsapp" boolean DEFAULT false NOT NULL,
	"deliver_slack" boolean DEFAULT false NOT NULL,
	"updated_by_email" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proactivity_alerts_rule_key_audience_unique" ON "proactivity_alerts" ("rule_key","audience");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactivity_alerts_audience_idx" ON "proactivity_alerts" ("audience");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proactivity_alert_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"admin_email" varchar(100) NOT NULL,
	"field_name" varchar(80) NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "proactivity_alert_change_logs" ADD CONSTRAINT "proactivity_alert_change_logs_alert_id_proactivity_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."proactivity_alerts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proactivity_alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"alert_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"dedup_key" varchar(255) NOT NULL,
	"status" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"reason_code" varchar(64),
	"error_message" text,
	"provider_message_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "proactivity_alert_deliveries" ADD CONSTRAINT "proactivity_alert_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "proactivity_alert_deliveries" ADD CONSTRAINT "proactivity_alert_deliveries_alert_id_proactivity_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."proactivity_alerts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proactivity_alert_deliveries_alert_channel_dedup_unique" ON "proactivity_alert_deliveries" ("alert_id","channel","dedup_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactivity_alert_deliveries_user_id_idx" ON "proactivity_alert_deliveries" ("user_id");
--> statement-breakpoint
INSERT INTO "proactivity_alerts" ("rule_key", "audience", "enabled", "thresholds", "deliver_whatsapp", "deliver_slack")
VALUES
	('roas_trigger', 'consultant', true, '{"minSpend":50,"roasTrigger":3}'::jsonb, false, false),
	('roas_scale', 'consultant', true, '{"minSpend":50,"roasValidated":5}'::jsonb, false, false),
	('cpa_alert', 'consultant', true, '{"minSpend":50,"cpaAlert":7.5}'::jsonb, false, false),
	('campaign_stalled', 'consultant', true, '{"stalledPausedDays":5,"minSpendForStalled":30}'::jsonb, false, false),
	('no_delivery', 'consultant', true, '{}'::jsonb, false, false),
	('low_ad_balance', 'client', true, '{"balanceRunwayDays":3,"minAvgDailySpendForRunway":5,"lowBalanceAbsoluteFloor":50}'::jsonb, false, false),
	('campaign_ended_good_roas', 'client', true, '{"goodRoasInfo":2,"goodRoasOpportunity":5,"minSpendForRoasSignal":50}'::jsonb, false, false),
	('high_roas_opportunity', 'client', true, '{"goodRoasOpportunity":5,"minSpendForRoasSignal":50}'::jsonb, false, false),
	('campaign_stalled', 'client', true, '{"stalledPausedDays":5,"minSpendForStalled":30}'::jsonb, false, false),
	('creative_fatigue', 'client', true, '{"creativeMinAgeDays":7,"creativeFatigueFrequency":3.5,"creativeCtrDropRatio":0.35,"creativeMinImpressions7d":1000}'::jsonb, false, false),
	('pixel_no_events', 'client', true, '{"pixelStaleDays":3}'::jsonb, false, false),
	('delivery_issue', 'client', true, '{"deliveryZeroImpressionHours":24,"pendingReviewMaxHours":48}'::jsonb, false, false)
ON CONFLICT ("rule_key", "audience") DO NOTHING;

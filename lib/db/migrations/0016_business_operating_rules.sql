CREATE TABLE IF NOT EXISTS "business_operating_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) DEFAULT 'default' NOT NULL,
	"renewal_critical_days" integer DEFAULT 3 NOT NULL,
	"renewal_attention_days" integer DEFAULT 7 NOT NULL,
	"trial_critical_days" integer DEFAULT 1 NOT NULL,
	"trial_attention_days" integer DEFAULT 3 NOT NULL,
	"inactivity_attention_days" integer DEFAULT 14 NOT NULL,
	"low_credits_threshold" integer DEFAULT 10 NOT NULL,
	"managed_campaign_name_prefix" varchar(32) DEFAULT '[AM]' NOT NULL,
	"active_managed_campaign_excludes_inactivity" boolean DEFAULT true NOT NULL,
	"updated_by_email" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_operating_rules_name_unique" ON "business_operating_rules" ("name");
--> statement-breakpoint
INSERT INTO "business_operating_rules" (
	"name",
	"renewal_critical_days",
	"renewal_attention_days",
	"trial_critical_days",
	"trial_attention_days",
	"inactivity_attention_days",
	"low_credits_threshold",
	"managed_campaign_name_prefix",
	"active_managed_campaign_excludes_inactivity"
)
VALUES ('default', 3, 7, 1, 3, 14, 10, '[AM]', true)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_rule_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"admin_email" varchar(100) NOT NULL,
	"field_name" varchar(80) NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "business_rule_change_logs" ADD CONSTRAINT "business_rule_change_logs_rule_id_business_operating_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."business_operating_rules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "business_managed_campaign_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ad_account_id" text NOT NULL,
	"ad_account_name" text,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"has_active_managed_campaign" boolean DEFAULT false NOT NULL,
	"managed_campaign_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "business_managed_campaign_cache" ADD CONSTRAINT "business_managed_campaign_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_managed_campaign_cache_user_ad_account_unique" ON "business_managed_campaign_cache" ("user_id","ad_account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_managed_campaign_cache_user_id_idx" ON "business_managed_campaign_cache" ("user_id");

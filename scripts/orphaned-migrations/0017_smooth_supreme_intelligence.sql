CREATE TABLE "ad_creative_edit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backoffice_user_email" varchar(100) NOT NULL,
	"target_user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text,
	"adset_id" text NOT NULL,
	"operation" varchar(16) NOT NULL,
	"edit_strategy" varchar(24),
	"source_ad_id" text,
	"result_ad_id" text,
	"paused_ad_id" text,
	"creative_id" text,
	"media_source" varchar(24) NOT NULL,
	"media_kind" varchar(12),
	"video_id" text,
	"video_status" varchar(12),
	"message" text,
	"applied_to_meta" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"notification_type" varchar NOT NULL,
	"expiration_date" timestamp NOT NULL,
	"mercadopago_payment_link_id" uuid,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_notification_deliveries_user_type_expiration_unique" UNIQUE("user_id","notification_type","expiration_date")
);
--> statement-breakpoint
CREATE TABLE "business_managed_campaign_cache" (
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
CREATE TABLE "business_operating_rules" (
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
CREATE TABLE "business_rule_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"admin_email" varchar(100) NOT NULL,
	"field_name" varchar(80) NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mercadopago_payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_type" varchar NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'brl' NOT NULL,
	"preference_id" varchar(255) NOT NULL,
	"init_point" text NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"source" varchar NOT NULL,
	"admin_email" varchar(100),
	"expires_at" timestamp NOT NULL,
	"paid_at" timestamp,
	"mercadopago_payment_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mercadopago_payment_links_preference_id_unique" UNIQUE("preference_id")
);
--> statement-breakpoint
CREATE TABLE "video_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"thumbnail_url" text,
	"video_preview_url" text,
	"category" varchar(128),
	"position" integer DEFAULT 0 NOT NULL,
	"status" varchar DEFAULT 'inactive' NOT NULL,
	"creatomate_template_id" varchar(255) NOT NULL,
	"video_source_key" varchar(128) DEFAULT 'Video-1' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_stripe_subscription_id_unique";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "stripe_subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "stripe_price_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "previous_pacing_type" jsonb;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "new_pacing_type" jsonb;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "previous_adset_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "new_adset_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "masterclass_lessons" ADD COLUMN "support_material_title" text;--> statement-breakpoint
ALTER TABLE "masterclass_lessons" ADD COLUMN "support_material_url" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider" varchar DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "mercadopago_payment_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "mercadopago_preference_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider" varchar DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_creative_edit_logs" ADD CONSTRAINT "ad_creative_edit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_notification_deliveries" ADD CONSTRAINT "billing_notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_notification_deliveries" ADD CONSTRAINT "billing_notification_deliveries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_notification_deliveries" ADD CONSTRAINT "billing_notification_deliveries_mercadopago_payment_link_id_mercadopago_payment_links_id_fk" FOREIGN KEY ("mercadopago_payment_link_id") REFERENCES "public"."mercadopago_payment_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_managed_campaign_cache" ADD CONSTRAINT "business_managed_campaign_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_rule_change_logs" ADD CONSTRAINT "business_rule_change_logs_rule_id_business_operating_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."business_operating_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mercadopago_payment_links" ADD CONSTRAINT "mercadopago_payment_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_managed_campaign_cache_user_ad_account_unique" ON "business_managed_campaign_cache" USING btree ("user_id","ad_account_id");--> statement-breakpoint
CREATE INDEX "business_managed_campaign_cache_user_id_idx" ON "business_managed_campaign_cache" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_operating_rules_name_unique" ON "business_operating_rules" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_unique" ON "subscriptions" USING btree ("stripe_subscription_id") WHERE "subscriptions"."stripe_subscription_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_mercadopago_payment_id_unique" UNIQUE("mercadopago_payment_id");
-- Isolated idempotent migration for the backoffice-owned ad creative audit table.
-- Kept scoped to ad_creative_edit_logs only: the MercadoPago Pix billing schema
-- (mercadopago_payment_links, billing_notification_deliveries, payments/subscriptions
-- .provider, subscriptions nullability) is owned by automatize-frontend's
-- 0012_mercadopago_pix_billing.sql on the shared DB and must NOT be touched here.

CREATE TABLE IF NOT EXISTS "ad_creative_edit_logs" (
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
DO $$ BEGIN
	ALTER TABLE "ad_creative_edit_logs" ADD CONSTRAINT "ad_creative_edit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

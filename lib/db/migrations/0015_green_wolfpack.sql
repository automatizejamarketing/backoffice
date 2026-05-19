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
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_stripe_subscription_id_unique";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "stripe_subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "stripe_price_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider" varchar DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "mercadopago_payment_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "mercadopago_preference_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider" varchar DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_creative_edit_logs" ADD CONSTRAINT "ad_creative_edit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_notification_deliveries" ADD CONSTRAINT "billing_notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_notification_deliveries" ADD CONSTRAINT "billing_notification_deliveries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_notification_deliveries" ADD CONSTRAINT "billing_notification_deliveries_mercadopago_payment_link_id_mercadopago_payment_links_id_fk" FOREIGN KEY ("mercadopago_payment_link_id") REFERENCES "public"."mercadopago_payment_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mercadopago_payment_links" ADD CONSTRAINT "mercadopago_payment_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_unique" ON "subscriptions" USING btree ("stripe_subscription_id") WHERE "subscriptions"."stripe_subscription_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_mercadopago_payment_id_unique" UNIQUE("mercadopago_payment_id");
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "provider" varchar DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "stripe_subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "stripe_price_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_stripe_subscription_id_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_id_unique" ON "subscriptions" ("stripe_subscription_id") WHERE "stripe_subscription_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider" varchar DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "mercadopago_payment_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "mercadopago_preference_id" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_mercadopago_payment_id_unique" ON "payments" ("mercadopago_payment_id") WHERE "mercadopago_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mercadopago_payment_links" (
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
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mercadopago_payment_links" ADD CONSTRAINT "mercadopago_payment_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"notification_type" varchar NOT NULL,
	"expiration_date" timestamp NOT NULL,
	"mercadopago_payment_link_id" uuid,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_notification_deliveries_user_type_expiration_unique" UNIQUE("user_id","notification_type","expiration_date")
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_notification_deliveries" ADD CONSTRAINT "billing_notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_notification_deliveries" ADD CONSTRAINT "billing_notification_deliveries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_notification_deliveries" ADD CONSTRAINT "billing_notification_deliveries_mercadopago_payment_link_id_mercadopago_payment_links_id_fk" FOREIGN KEY ("mercadopago_payment_link_id") REFERENCES "public"."mercadopago_payment_links"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

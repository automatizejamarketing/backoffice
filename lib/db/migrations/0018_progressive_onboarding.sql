ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_card_dismissed_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_welcome_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "business_phone" varchar(32);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "google_place_id" varchar(255);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "business_address" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "business_operating_hours" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_profile_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_campaign_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_post_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "onboarding_brand_completed_at" timestamp;--> statement-breakpoint
UPDATE "users" SET "onboarding_card_dismissed_at" = now() WHERE "onboarding_card_dismissed_at" IS NULL;

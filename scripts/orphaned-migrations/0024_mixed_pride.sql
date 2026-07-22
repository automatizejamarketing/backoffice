CREATE TABLE "ai_campaign_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"meta_business_account_id" text,
	"ad_account_id" text NOT NULL,
	"page_id" text,
	"instagram_user_id" text,
	"goal" text NOT NULL,
	"niche" varchar(64),
	"intent" jsonb NOT NULL,
	"inspiration_campaign_ids" jsonb,
	"mode" varchar DEFAULT 'simulated' NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"created_meta_ids" jsonb,
	"validate_only_result" jsonb,
	"error" jsonb,
	"inngest_event_id" text,
	"inngest_run_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "ai_campaign_drafts" ADD CONSTRAINT "ai_campaign_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_campaign_drafts" ADD CONSTRAINT "ai_campaign_drafts_meta_business_account_id_meta_business_accounts_id_fk" FOREIGN KEY ("meta_business_account_id") REFERENCES "public"."meta_business_accounts"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "campaign_edit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backoffice_user_email" varchar(100) NOT NULL,
	"target_user_id" uuid NOT NULL,
	"campaign_id" text NOT NULL,
	"account_id" text NOT NULL,
	"campaign_name" text,
	"previous_budget_mode" varchar(16) NOT NULL,
	"new_budget_mode" varchar(16) NOT NULL,
	"previous_daily_budget" numeric,
	"new_daily_budget" numeric,
	"adset_budget_changes" jsonb,
	"note" text NOT NULL,
	"applied_to_meta" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ADD CONSTRAINT "campaign_edit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
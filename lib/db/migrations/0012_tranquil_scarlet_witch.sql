ALTER TABLE "adset_edit_logs" ADD COLUMN "previous_lifetime_budget" numeric;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "new_lifetime_budget" numeric;--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ADD COLUMN "previous_lifetime_budget" numeric;--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ADD COLUMN "new_lifetime_budget" numeric;
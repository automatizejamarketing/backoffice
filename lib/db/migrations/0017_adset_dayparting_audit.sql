ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "previous_pacing_type" jsonb;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "new_pacing_type" jsonb;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "previous_adset_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "new_adset_schedule" jsonb;

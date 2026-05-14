ALTER TABLE "campaign_edit_logs" ALTER COLUMN "note" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ADD COLUMN IF NOT EXISTS "source" varchar(16) DEFAULT 'admin' NOT NULL;
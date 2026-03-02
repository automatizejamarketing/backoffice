DO $$ BEGIN
  ALTER TABLE "ai_usage_logs" DROP CONSTRAINT IF EXISTS "ai_usage_logs_chat_id_chats_id_fk";
EXCEPTION WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_usage_logs" DROP CONSTRAINT IF EXISTS "ai_usage_logs_post_id_posts_id_fk";
EXCEPTION WHEN undefined_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" DROP COLUMN IF EXISTS "action";--> statement-breakpoint
ALTER TABLE "ai_usage_logs" DROP COLUMN IF EXISTS "chat_id";--> statement-breakpoint
ALTER TABLE "ai_usage_logs" DROP COLUMN IF EXISTS "post_id";--> statement-breakpoint
ALTER TABLE "ai_usage_logs" DROP COLUMN IF EXISTS "metadata";

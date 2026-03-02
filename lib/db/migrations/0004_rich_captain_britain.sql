CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"text" varchar DEFAULT 'text' NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "documents_id_created_at_pk" PRIMARY KEY("id","created_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instagram_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"instagram_user_id" text,
	"username" text,
	"name" text,
	"website" text,
	"biography" text,
	"profile_picture_url" text,
	"media_count" integer,
	"access_token" text NOT NULL,
	"token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "instagram_accounts_user_id_account_id_unique" UNIQUE("user_id","account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "narrative_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"generated_narratives" jsonb,
	"selected_narrative" jsonb,
	"generated_headlines" jsonb,
	"selected_headline" text,
	"central_tesis" jsonb,
	"generated_script" jsonb,
	"content_format" varchar,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ai_generated_image_id" uuid,
	"media_url" text,
	"media_type" varchar(32),
	"caption" text NOT NULL,
	"location_id" text,
	"user_tags_json" text,
	"scheduled_at" timestamp NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"retry_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"last_error_message" text,
	"media_container_id" text,
	"media_container_status" varchar(32),
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "scheduled_posts_media_container_id_unique" UNIQUE("media_container_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "streams" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "streams_id_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suggestions" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"document_created_at" timestamp NOT NULL,
	"original_text" text NOT NULL,
	"suggested_text" text NOT NULL,
	"description" text,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "suggestions_id_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "votes" (
	"chat_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"is_upvoted" boolean NOT NULL,
	CONSTRAINT "votes_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
DO $$ 
BEGIN
  -- Only rename if the old column exists and new column doesn't exist
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'backoffice_generated_posts' 
    AND column_name = 'source_user_post_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'backoffice_generated_posts' 
    AND column_name = 'source_user_generated_image_id'
  ) THEN
    ALTER TABLE "backoffice_generated_posts" RENAME COLUMN "source_user_post_id" TO "source_user_generated_image_id";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD COLUMN "locale" varchar(10);
EXCEPTION WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "narrative_sessions" ADD CONSTRAINT "narrative_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "streams" ADD CONSTRAINT "streams_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_document_id_document_created_at_documents_id_created_at_fk" FOREIGN KEY ("document_id","document_created_at") REFERENCES "public"."documents"("id","created_at") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "votes" ADD CONSTRAINT "votes_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "votes" ADD CONSTRAINT "votes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_generated_text" ADD CONSTRAINT "ai_generated_text_ai_usage_log_id_ai_usage_logs_id_fk" FOREIGN KEY ("ai_usage_log_id") REFERENCES "public"."ai_usage_logs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_source_user_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("source_user_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_generated_images" ADD CONSTRAINT "ai_generated_images_ai_usage_log_id_ai_usage_logs_id_fk" FOREIGN KEY ("ai_usage_log_id") REFERENCES "public"."ai_usage_logs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "posts" ADD CONSTRAINT "posts_scheduled_post_id_scheduled_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
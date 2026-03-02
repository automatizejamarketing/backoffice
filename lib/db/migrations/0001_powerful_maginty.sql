CREATE TABLE IF NOT EXISTS "ai_generated_text" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"text" text,
	"ai_usage_log_id" uuid,
	"status" text DEFAULT 'generating' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backoffice_generated_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backoffice_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"source_user_post_id" uuid,
	"source_backoffice_post_id" uuid,
	"prompt" text NOT NULL,
	"generated_image_id" uuid,
	"caption_text_id" uuid,
	"reference_image_urls" jsonb DEFAULT '[]'::jsonb,
	"aspect_ratio" varchar(10) DEFAULT '1:1',
	"status" varchar(32) DEFAULT 'generating' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_service_post_criativo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ai_generated_image_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"category" varchar,
	"theme" text NOT NULL,
	"use_realistic_mockup" boolean DEFAULT false NOT NULL,
	"caption_text_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_service_post_do_prato" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ai_generated_image_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"post_style" varchar,
	"caption_objective" text,
	"caption_length" text,
	"caption_text_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "food_service_story_turbo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ai_generated_image_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"story_style" varchar,
	"text_objective" varchar,
	"text_generation_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_generated_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"media_type" varchar(32) DEFAULT 'IMAGE' NOT NULL,
	"aspect_ratio" varchar DEFAULT '1:1' NOT NULL,
	"width" integer DEFAULT 1024 NOT NULL,
	"height" integer DEFAULT 1024 NOT NULL,
	"image" text,
	"public_image_url" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"ai_usage_log_id" uuid,
	"position" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generic_generate_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"prompt_description" text NOT NULL,
	"aspect_ratio" varchar DEFAULT '1:1' NOT NULL,
	"post_image_id" uuid NOT NULL,
	"caption_text_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_url" text NOT NULL,
	"ai_generated_image_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "niche" varchar(128);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "sub_niche" varchar(128);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "post_type" varchar;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "source_image" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "product_name" varchar(255);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "post_style" varchar;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "story_style" varchar;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "text_objective" varchar;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "scheduled_post_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_generated_text" ADD CONSTRAINT "ai_generated_text_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_backoffice_user_id_users_id_fk" FOREIGN KEY ("backoffice_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_source_user_post_id_posts_id_fk" FOREIGN KEY ("source_user_post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_caption_text_id_ai_generated_text_id_fk" FOREIGN KEY ("caption_text_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "food_service_post_criativo" ADD CONSTRAINT "food_service_post_criativo_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "food_service_post_criativo" ADD CONSTRAINT "food_service_post_criativo_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "food_service_post_criativo" ADD CONSTRAINT "food_service_post_criativo_caption_text_id_ai_generated_text_id_fk" FOREIGN KEY ("caption_text_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "food_service_post_do_prato" ADD CONSTRAINT "food_service_post_do_prato_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "food_service_post_do_prato" ADD CONSTRAINT "food_service_post_do_prato_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "food_service_post_do_prato" ADD CONSTRAINT "food_service_post_do_prato_caption_text_id_ai_generated_text_id_fk" FOREIGN KEY ("caption_text_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "food_service_story_turbo" ADD CONSTRAINT "food_service_story_turbo_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "food_service_story_turbo" ADD CONSTRAINT "food_service_story_turbo_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "food_service_story_turbo" ADD CONSTRAINT "food_service_story_turbo_text_generation_id_ai_generated_text_id_fk" FOREIGN KEY ("text_generation_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_generated_images" ADD CONSTRAINT "ai_generated_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "generic_generate_post" ADD CONSTRAINT "generic_generate_post_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "generic_generate_post" ADD CONSTRAINT "generic_generate_post_post_image_id_ai_generated_images_id_fk" FOREIGN KEY ("post_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "generic_generate_post" ADD CONSTRAINT "generic_generate_post_caption_text_id_ai_generated_text_id_fk" FOREIGN KEY ("caption_text_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

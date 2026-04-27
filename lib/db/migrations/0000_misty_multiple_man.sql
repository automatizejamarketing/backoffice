CREATE TABLE "adset_edit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backoffice_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"adset_id" text NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text,
	"adset_name" text,
	"previous_daily_budget" numeric,
	"new_daily_budget" numeric,
	"previous_targeting" jsonb,
	"new_targeting" jsonb,
	"note" text NOT NULL,
	"applied_to_meta" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_generated_text" (
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
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"model_id" varchar(128) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost" numeric(12, 8) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "backoffice_generated_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backoffice_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"source_user_generated_image_id" uuid,
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
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp NOT NULL,
	"title" text NOT NULL,
	"user_id" uuid NOT NULL,
	"visibility" varchar DEFAULT 'private' NOT NULL,
	"last_context" jsonb
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"website_url" varchar(512),
	"instagram_handle" varchar(64),
	"industry" varchar(128),
	"niche" varchar(128),
	"sub_niche" varchar(128),
	"brand_voice" varchar,
	"target_audience" text,
	"brand_colors" jsonb,
	"logo_url" text,
	"content_themes" jsonb,
	"hashtags" jsonb,
	"preferred_formats" jsonb,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"description" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"text" varchar DEFAULT 'text' NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "documents_id_created_at_pk" PRIMARY KEY("id","created_at")
);
--> statement-breakpoint
CREATE TABLE "food_service_flyer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ai_generated_image_id" uuid NOT NULL,
	"template_category" varchar(128) NOT NULL,
	"template_name" varchar(255) NOT NULL,
	"product_name" varchar(255),
	"user_prompt" text,
	"aspect_ratio" varchar(16),
	"caption_text_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "food_service_post_criativo" (
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
CREATE TABLE "food_service_post_do_prato" (
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
CREATE TABLE "ai_generated_images" (
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
CREATE TABLE "ai_generated_image_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"parent_version_id" uuid,
	"generated_image_id" uuid NOT NULL,
	"source_ai_generated_image_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generic_generate_post" (
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
CREATE TABLE "instagram_accounts" (
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
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" varchar NOT NULL,
	"parts" json NOT NULL,
	"attachments" json NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_business_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"facebook_user_id" text NOT NULL,
	"name" text,
	"picture_url" text,
	"access_token" text NOT NULL,
	"token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "meta_business_accounts_user_id_facebook_user_id_unique" UNIQUE("user_id","facebook_user_id")
);
--> statement-breakpoint
CREATE TABLE "narrative_sessions" (
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
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"stripe_invoice_id" varchar(255),
	"stripe_payment_intent_id" varchar(255),
	"stripe_charge_id" varchar(255),
	"amount" integer NOT NULL,
	"currency" varchar(10) NOT NULL,
	"status" varchar NOT NULL,
	"plan_type" varchar NOT NULL,
	"description" text,
	"failure_reason" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "pending_plan_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"current_plan_type" varchar NOT NULL,
	"new_plan_type" varchar NOT NULL,
	"new_stripe_price_id" varchar(255) NOT NULL,
	"change_type" varchar NOT NULL,
	"effective_date" timestamp NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_price_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_type" varchar NOT NULL,
	"stripe_price_id" varchar(255) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(10) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"width" integer DEFAULT 1080 NOT NULL,
	"height" integer DEFAULT 1080 NOT NULL,
	"layers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rendered_image" text,
	"thumbnail_image" text,
	"title" varchar(255),
	"caption" text,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"post_type" varchar,
	"source_image" text,
	"product_name" varchar(255),
	"post_style" varchar,
	"story_style" varchar,
	"text_objective" varchar,
	"scheduled_at" timestamp,
	"published_at" timestamp,
	"scheduled_post_id" uuid,
	"chat_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_event_id" varchar(255) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "processed_webhook_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "reference_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_url" text NOT NULL,
	"ai_generated_image_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ai_generated_image_id" uuid,
	"media_url" text,
	"media_type" varchar(32),
	"caption" text,
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
CREATE TABLE "streams" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "streams_id_pk" PRIMARY KEY("id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_subscription_id" varchar(255) NOT NULL,
	"stripe_price_id" varchar(255) NOT NULL,
	"plan_type" varchar NOT NULL,
	"status" varchar NOT NULL,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"event_type" varchar NOT NULL,
	"from_plan" varchar,
	"to_plan" varchar,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(64) NOT NULL,
	"name" varchar(100),
	"password" text,
	"auth_provider" varchar(20) DEFAULT 'google' NOT NULL,
	"email_verified" timestamp,
	"image_url" text,
	"locale" varchar(10),
	"stripe_customer_id" varchar(255),
	"expiration_date" timestamp,
	"credits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_companies" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" varchar DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_companies_user_id_company_id_pk" PRIMARY KEY("user_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"type" varchar(30) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "verification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"chat_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"is_upvoted" boolean NOT NULL,
	CONSTRAINT "votes_chat_id_message_id_pk" PRIMARY KEY("chat_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD CONSTRAINT "adset_edit_logs_backoffice_user_id_users_id_fk" FOREIGN KEY ("backoffice_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD CONSTRAINT "adset_edit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_text" ADD CONSTRAINT "ai_generated_text_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_text" ADD CONSTRAINT "ai_generated_text_ai_usage_log_id_ai_usage_logs_id_fk" FOREIGN KEY ("ai_usage_log_id") REFERENCES "public"."ai_usage_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_backoffice_user_id_users_id_fk" FOREIGN KEY ("backoffice_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_source_user_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("source_user_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backoffice_generated_posts" ADD CONSTRAINT "backoffice_generated_posts_caption_text_id_ai_generated_text_id_fk" FOREIGN KEY ("caption_text_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_service_flyer" ADD CONSTRAINT "food_service_flyer_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_service_flyer" ADD CONSTRAINT "food_service_flyer_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_service_flyer" ADD CONSTRAINT "food_service_flyer_caption_text_id_ai_generated_text_id_fk" FOREIGN KEY ("caption_text_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_service_post_criativo" ADD CONSTRAINT "food_service_post_criativo_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_service_post_criativo" ADD CONSTRAINT "food_service_post_criativo_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_service_post_criativo" ADD CONSTRAINT "food_service_post_criativo_caption_text_id_ai_generated_text_id_fk" FOREIGN KEY ("caption_text_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_service_post_do_prato" ADD CONSTRAINT "food_service_post_do_prato_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_service_post_do_prato" ADD CONSTRAINT "food_service_post_do_prato_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_service_post_do_prato" ADD CONSTRAINT "food_service_post_do_prato_caption_text_id_ai_generated_text_id_fk" FOREIGN KEY ("caption_text_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_images" ADD CONSTRAINT "ai_generated_images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_images" ADD CONSTRAINT "ai_generated_images_ai_usage_log_id_ai_usage_logs_id_fk" FOREIGN KEY ("ai_usage_log_id") REFERENCES "public"."ai_usage_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_image_versions" ADD CONSTRAINT "ai_generated_image_versions_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_image_versions" ADD CONSTRAINT "ai_generated_image_versions_source_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("source_ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_image_versions" ADD CONSTRAINT "ai_generated_image_versions_parent_version_id_ai_generated_image_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."ai_generated_image_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generic_generate_post" ADD CONSTRAINT "generic_generate_post_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generic_generate_post" ADD CONSTRAINT "generic_generate_post_post_image_id_ai_generated_images_id_fk" FOREIGN KEY ("post_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generic_generate_post" ADD CONSTRAINT "generic_generate_post_caption_text_id_ai_generated_text_id_fk" FOREIGN KEY ("caption_text_id") REFERENCES "public"."ai_generated_text"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_accounts" ADD CONSTRAINT "instagram_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_business_accounts" ADD CONSTRAINT "meta_business_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_sessions" ADD CONSTRAINT "narrative_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_plan_changes" ADD CONSTRAINT "pending_plan_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_plan_changes" ADD CONSTRAINT "pending_plan_changes_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_scheduled_post_id_scheduled_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_images" ADD CONSTRAINT "reference_images_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streams" ADD CONSTRAINT "streams_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_document_id_document_created_at_documents_id_created_at_fk" FOREIGN KEY ("document_id","document_created_at") REFERENCES "public"."documents"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
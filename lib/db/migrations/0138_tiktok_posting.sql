CREATE TABLE IF NOT EXISTS "tiktok_oauth_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "state_hash" varchar(64) NOT NULL,
  "redirect_uri" text NOT NULL,
  "return_to" text,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tiktok_oauth_attempts_state_hash_unique" UNIQUE("state_hash")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tiktok_oauth_attempts_user_idx" ON "tiktok_oauth_attempts" ("user_id","expires_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tiktok_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "open_id" varchar(128) NOT NULL,
  "union_id" varchar(128),
  "username" varchar(128),
  "display_name" varchar(255),
  "avatar_url" text,
  "scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "access_token_encrypted" text,
  "access_token_expires_at" timestamp,
  "refresh_token_encrypted" text,
  "refresh_token_expires_at" timestamp,
  "needs_reconnect_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tiktok_accounts_active_user_unique" ON "tiktok_accounts" ("user_id") WHERE "revoked_at" is null;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tiktok_publications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tiktok_account_id" uuid NOT NULL REFERENCES "tiktok_accounts"("id"),
  "post_id" uuid REFERENCES "posts"("id") ON DELETE SET NULL,
  "publish_id" varchar(128) NOT NULL,
  "media_kind" varchar NOT NULL,
  "media_url" text NOT NULL,
  "privacy_level" varchar(40) NOT NULL,
  "title" text,
  "options" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" varchar DEFAULT 'processing' NOT NULL,
  "fail_reason" varchar(120),
  "tiktok_post_ids" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "published_at" timestamp,
  CONSTRAINT "tiktok_publications_publish_id_unique" UNIQUE("publish_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tiktok_publications_user_created_idx" ON "tiktok_publications" ("user_id","created_at");

-- Idempotent repair for shared databases where frontend migrations advanced
-- drizzle.__drizzle_migrations past older backoffice-only entries.

CREATE TABLE IF NOT EXISTS "backoffice_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(100) NOT NULL,
	"name" varchar(100),
	"role" varchar DEFAULT 'marketing_consultant' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "backoffice_users" ADD CONSTRAINT "backoffice_users_email_unique" UNIQUE("email");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_marketing_consultants" (
	"user_id" uuid NOT NULL,
	"consultant_id" uuid NOT NULL,
	"assigned_by_email" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_marketing_consultants" ADD CONSTRAINT "user_marketing_consultants_user_id_pk" PRIMARY KEY("user_id");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_marketing_consultants_consultant_id_idx" ON "user_marketing_consultants" ("consultant_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_marketing_consultants" ADD CONSTRAINT "user_marketing_consultants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_marketing_consultants" ADD CONSTRAINT "user_marketing_consultants_consultant_id_backoffice_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."backoffice_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backoffice_magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(100) NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "backoffice_magic_links" ADD CONSTRAINT "backoffice_magic_links_token_hash_unique" UNIQUE("token_hash");
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backoffice_magic_links_email_idx" ON "backoffice_magic_links" ("email");
--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "previous_start_time" text;
--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "new_start_time" text;
--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "previous_end_time" text;
--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "new_end_time" text;
--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "previous_lifetime_budget" numeric;
--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN IF NOT EXISTS "new_lifetime_budget" numeric;
--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ADD COLUMN IF NOT EXISTS "adset_schedule_changes" jsonb;
--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ADD COLUMN IF NOT EXISTS "previous_lifetime_budget" numeric;
--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ADD COLUMN IF NOT EXISTS "new_lifetime_budget" numeric;
--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ALTER COLUMN "note" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ADD COLUMN IF NOT EXISTS "source" varchar(16);
--> statement-breakpoint
UPDATE "campaign_edit_logs" SET "source" = 'admin' WHERE "source" IS NULL;
--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ALTER COLUMN "source" SET DEFAULT 'admin';
--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ALTER COLUMN "source" SET NOT NULL;

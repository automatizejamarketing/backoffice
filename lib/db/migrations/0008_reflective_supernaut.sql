-- Idempotent: backfill schema parity with automatize-frontend.
-- The shared Postgres already has these objects (created by the frontend's
-- migrations 0007 commitment fields, 0008 users.phone), and the backoffice's
-- own 0007_masterclass_courses_lessons.sql created the masterclass tables.
-- This migration registers them in backoffice's __drizzle_migrations history
-- without re-executing anything destructive.
CREATE TABLE IF NOT EXISTS "masterclass_courses" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "masterclass_courses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "masterclass_lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"video_provider" varchar(20) DEFAULT 'youtube' NOT NULL,
	"video_asset_id" text NOT NULL,
	"position" integer NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "masterclass_lessons_course_position_unique" UNIQUE("course_id","position"),
	CONSTRAINT "masterclass_lessons_course_slug_unique" UNIQUE("course_id","slug")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "commitment_end_date" timestamp;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "commitment_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" varchar(16);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "masterclass_lessons" ADD CONSTRAINT "masterclass_lessons_course_id_masterclass_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."masterclass_courses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

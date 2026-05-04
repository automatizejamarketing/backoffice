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

DO $$ BEGIN
 ALTER TABLE "masterclass_lessons" ADD CONSTRAINT "masterclass_lessons_course_id_masterclass_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."masterclass_courses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "masterclass_lessons_course_id_position_idx"
  ON "masterclass_lessons" ("course_id", "position");

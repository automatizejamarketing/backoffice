CREATE TABLE IF NOT EXISTS "trackable_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "slug" varchar(255) NOT NULL,
  "created_by" varchar(100),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);

CREATE TABLE IF NOT EXISTS "trackable_link_clicks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trackable_link_id" uuid NOT NULL REFERENCES "trackable_links"("id"),
  "ip_hash" varchar(64),
  "user_agent" text,
  "referrer_url" text,
  "landing_url" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_trackable_link_id" uuid;

-- Slug is globally unique and never reused (even after soft-delete).
CREATE UNIQUE INDEX IF NOT EXISTS "trackable_links_slug_unique" ON "trackable_links" ("slug");

-- Name must be unique among ACTIVE (non-deleted) links, case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS "trackable_links_active_name_unique"
  ON "trackable_links" (lower("name"))
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "trackable_link_clicks_link_id_idx" ON "trackable_link_clicks" ("trackable_link_id");

CREATE INDEX IF NOT EXISTS "users_referred_by_trackable_link_id_idx" ON "users" ("referred_by_trackable_link_id");

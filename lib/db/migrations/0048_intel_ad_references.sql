CREATE TABLE IF NOT EXISTS "advertisers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_advertiser_id" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "instagram_handle" varchar(255),
  "facebook_page_id" varchar(255),
  "investment_intensity_score" integer DEFAULT 0,
  "state" varchar(50),
  "city" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "advertisers_external_advertiser_id_unique" UNIQUE("external_advertiser_id")
);

CREATE INDEX IF NOT EXISTS "advertisers_instagram_handle_idx" ON "advertisers" ("instagram_handle");
CREATE INDEX IF NOT EXISTS "advertisers_investment_intensity_score_idx" ON "advertisers" ("investment_intensity_score");

CREATE TABLE IF NOT EXISTS "ad_creatives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "advertiser_id" uuid NOT NULL REFERENCES "advertisers" ("id"),
  "external_ad_id" varchar(255) NOT NULL,
  "body" text,
  "headline" text,
  "description" text,
  "call_to_action" varchar(100),
  "video_url" text,
  "thumbnail_url" text,
  "category" varchar(100) NOT NULL,
  "subcategory" varchar(100) NOT NULL,
  "category_confidence" numeric(3,2),
  "product_relevance_score" integer,
  "creative_strength_score" integer,
  "advertiser_continuity_score" integer,
  "creative_type" varchar(50),
  "is_active" boolean DEFAULT true NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "platforms" jsonb,
  "start_date" timestamp,
  "first_seen_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ad_creatives_external_ad_id_unique" UNIQUE("external_ad_id")
);

CREATE INDEX IF NOT EXISTS "ad_creatives_advertiser_id_idx" ON "ad_creatives" ("advertiser_id");
CREATE INDEX IF NOT EXISTS "ad_creatives_category_idx" ON "ad_creatives" ("category");
CREATE INDEX IF NOT EXISTS "ad_creatives_subcategory_idx" ON "ad_creatives" ("subcategory");
CREATE INDEX IF NOT EXISTS "ad_creatives_is_active_idx" ON "ad_creatives" ("is_active");
CREATE INDEX IF NOT EXISTS "ad_creatives_is_published_idx" ON "ad_creatives" ("is_published");

CREATE TABLE IF NOT EXISTS "ad_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ad_creative_id" uuid NOT NULL REFERENCES "ad_creatives" ("id"),
  "is_active" boolean NOT NULL,
  "checked_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ad_snapshots_ad_creative_id_idx" ON "ad_snapshots" ("ad_creative_id");
CREATE INDEX IF NOT EXISTS "ad_snapshots_checked_at_idx" ON "ad_snapshots" ("checked_at");


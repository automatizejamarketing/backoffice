CREATE TABLE IF NOT EXISTS "company_locations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" varchar(255),
  "google_place_id" varchar(255),
  "business_phone" varchar(32),
  "business_address" jsonb,
  "business_operating_hours" jsonb,
  "is_primary" boolean DEFAULT false NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "company_locations_company_id_idx" ON "company_locations" ("company_id");

CREATE UNIQUE INDEX IF NOT EXISTS "company_locations_company_place_unique"
  ON "company_locations" ("company_id", "google_place_id")
  WHERE "google_place_id" IS NOT NULL;

-- Backfill primary location from existing company profile data
INSERT INTO "company_locations" (
  "company_id",
  "name",
  "google_place_id",
  "business_phone",
  "business_address",
  "business_operating_hours",
  "is_primary",
  "sort_order"
)
SELECT
  c."id",
  c."name",
  c."google_place_id",
  c."business_phone",
  c."business_address",
  c."business_operating_hours",
  true,
  0
FROM "companies" c
WHERE (
  c."business_address" IS NOT NULL
  OR c."google_place_id" IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM "company_locations" cl WHERE cl."company_id" = c."id"
);

CREATE TABLE IF NOT EXISTS "expert_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "display_name" varchar(120) NOT NULL,
  "phone" varchar(20),
  "pix_key" varchar(255) NOT NULL,
  "status" varchar DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "expert_profiles_user_id_unique" UNIQUE("user_id"),
  CONSTRAINT "expert_profiles_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "expert_profiles_status_idx"
  ON "expert_profiles" ("status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "owner_type" varchar DEFAULT 'automatize' NOT NULL,
  "expert_id" uuid,
  "slug" varchar(160) NOT NULL,
  "title" varchar(180) NOT NULL,
  "description" text,
  "cover_url" text,
  "price_centavos" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'brl' NOT NULL,
  "expert_share_basis_points" integer DEFAULT 0 NOT NULL,
  "minimum_plan_tier" varchar,
  "visibility" varchar DEFAULT 'unlisted' NOT NULL,
  "status" varchar DEFAULT 'draft' NOT NULL,
  "sales_enabled" boolean DEFAULT true NOT NULL,
  "terms_version" varchar(40) DEFAULT 'v1' NOT NULL,
  "legacy_masterclass_course_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "products_slug_unique" UNIQUE("slug"),
  CONSTRAINT "products_legacy_masterclass_course_unique"
    UNIQUE("legacy_masterclass_course_id"),
  CONSTRAINT "products_expert_id_expert_profiles_id_fk"
    FOREIGN KEY ("expert_id") REFERENCES "public"."expert_profiles"("id"),
  CONSTRAINT "products_price_non_negative" CHECK ("price_centavos" >= 0),
  CONSTRAINT "products_expert_share_range"
    CHECK ("expert_share_basis_points" >= 0 AND "expert_share_basis_points" <= 10000),
  CONSTRAINT "products_owner_consistency" CHECK (
    ("owner_type" = 'automatize' AND "expert_id" IS NULL AND "expert_share_basis_points" = 0)
    OR ("owner_type" = 'expert' AND "expert_id" IS NOT NULL)
  )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "products_catalog_idx"
  ON "products" ("status", "visibility", "sales_enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_expert_id_idx"
  ON "products" ("expert_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "product_content_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "type" varchar NOT NULL,
  "title" varchar(180) NOT NULL,
  "description" text,
  "source_url" text,
  "blob_pathname" text,
  "video_provider" varchar(30),
  "filename" text,
  "mime_type" varchar(160),
  "position" integer NOT NULL,
  "published" boolean DEFAULT true NOT NULL,
  "legacy_masterclass_lesson_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_content_items_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE,
  CONSTRAINT "product_content_items_position_unique"
    UNIQUE("product_id", "position"),
  CONSTRAINT "product_content_items_source_required"
    CHECK ("source_url" IS NOT NULL OR "blob_pathname" IS NOT NULL)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "product_content_items_product_published_idx"
  ON "product_content_items" ("product_id", "published");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_content_items_legacy_lesson_idx"
  ON "product_content_items" ("legacy_masterclass_lesson_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "product_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "expert_id_snapshot" uuid,
  "user_id" uuid,
  "acquisition_key" varchar(255) NOT NULL,
  "buyer_name" varchar(120) NOT NULL,
  "buyer_email" varchar(255) NOT NULL,
  "buyer_phone" varchar(20),
  "product_title_snapshot" varchar(180) NOT NULL,
  "price_centavos" integer NOT NULL,
  "currency" varchar(3) DEFAULT 'brl' NOT NULL,
  "expert_share_basis_points" integer DEFAULT 0 NOT NULL,
  "terms_version" varchar(40) NOT NULL,
  "terms_accepted_at" timestamp NOT NULL,
  "marketing_opt_in" boolean DEFAULT false NOT NULL,
  "attribution" jsonb,
  "status" varchar DEFAULT 'pending' NOT NULL,
  "approved_at" timestamp,
  "refunded_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_orders_acquisition_key_unique" UNIQUE("acquisition_key"),
  CONSTRAINT "product_orders_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id"),
  CONSTRAINT "product_orders_expert_id_snapshot_expert_profiles_id_fk"
    FOREIGN KEY ("expert_id_snapshot") REFERENCES "public"."expert_profiles"("id"),
  CONSTRAINT "product_orders_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
  CONSTRAINT "product_orders_snapshot_consistency"
    CHECK ("price_centavos" >= 0 AND "currency" = 'brl'
      AND "expert_share_basis_points" >= 0
      AND "expert_share_basis_points" <= 10000
      AND (("expert_id_snapshot" IS NULL AND "expert_share_basis_points" = 0)
        OR "expert_id_snapshot" IS NOT NULL))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "product_orders_product_id_idx"
  ON "product_orders" ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_orders_user_id_idx"
  ON "product_orders" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_orders_buyer_email_idx"
  ON "product_orders" ("buyer_email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_orders_one_open_purchase"
  ON "product_orders" ("product_id", "buyer_email")
  WHERE "status" IN ('pending', 'approved');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_orders_status_created_idx"
  ON "product_orders" ("status", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "product_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "provider" varchar(30) DEFAULT 'mercadopago' NOT NULL,
  "provider_preference_id" varchar(255),
  "provider_payment_id" varchar(255),
  "status" varchar DEFAULT 'pending' NOT NULL,
  "gross_amount_centavos" integer,
  "net_amount_centavos" integer,
  "fee_amount_centavos" integer,
  "currency" varchar(3) DEFAULT 'brl' NOT NULL,
  "raw_status" varchar(80),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_payments_order_id_unique" UNIQUE("order_id"),
  CONSTRAINT "product_payments_order_id_product_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."product_orders"("id")
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "product_payments_provider_payment_unique"
  ON "product_payments" ("provider", "provider_payment_id")
  WHERE "provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_payments_order_id_idx"
  ON "product_payments" ("order_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "product_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "product_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "order_id" uuid,
  "source" varchar NOT NULL,
  "granted_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp,
  CONSTRAINT "product_entitlements_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id"),
  CONSTRAINT "product_entitlements_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
  CONSTRAINT "product_entitlements_order_id_product_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."product_orders"("id")
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "product_entitlements_active_unique"
  ON "product_entitlements" ("product_id", "user_id")
  WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_entitlements_user_id_idx"
  ON "product_entitlements" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_entitlements_order_id_idx"
  ON "product_entitlements" ("order_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "expert_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expert_id" uuid NOT NULL,
  "order_id" uuid,
  "event_key" varchar(255) NOT NULL,
  "type" varchar NOT NULL,
  "amount_centavos" integer NOT NULL,
  "available_at" timestamp,
  "description" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "expert_ledger_entries_event_key_unique" UNIQUE("event_key"),
  CONSTRAINT "expert_ledger_entries_expert_id_expert_profiles_id_fk"
    FOREIGN KEY ("expert_id") REFERENCES "public"."expert_profiles"("id"),
  CONSTRAINT "expert_ledger_entries_order_id_product_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."product_orders"("id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "expert_ledger_entries_expert_available_idx"
  ON "expert_ledger_entries" ("expert_id", "available_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expert_ledger_entries_order_id_idx"
  ON "expert_ledger_entries" ("order_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "expert_payout_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expert_id" uuid NOT NULL,
  "amount_centavos" integer NOT NULL,
  "pix_key_snapshot" varchar(255) NOT NULL,
  "status" varchar DEFAULT 'requested' NOT NULL,
  "due_at" timestamp NOT NULL,
  "proof_url" text,
  "admin_email" varchar(120),
  "reviewed_at" timestamp,
  "paid_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "expert_payout_requests_expert_id_expert_profiles_id_fk"
    FOREIGN KEY ("expert_id") REFERENCES "public"."expert_profiles"("id"),
  CONSTRAINT "expert_payout_requests_minimum_amount"
    CHECK ("amount_centavos" >= 10000)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "expert_payout_requests_expert_status_idx"
  ON "expert_payout_requests" ("expert_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expert_payout_requests_one_open"
  ON "expert_payout_requests" ("expert_id")
  WHERE "status" IN ('requested', 'approved');--> statement-breakpoint

INSERT INTO "products" (
  "owner_type", "slug", "title", "description", "price_centavos", "currency",
  "expert_share_basis_points", "minimum_plan_tier", "visibility", "status",
  "sales_enabled", "terms_version", "legacy_masterclass_course_id",
  "created_at", "updated_at"
)
SELECT
  'automatize', mc."slug", mc."title", mc."description", 0, 'brl', 0,
  'starter', 'unlisted',
  CASE WHEN mc."published" THEN 'published' ELSE 'draft' END,
  false, 'legacy-masterclass-v1', mc."id", mc."created_at", mc."updated_at"
FROM "masterclass_courses" mc
ON CONFLICT ("legacy_masterclass_course_id") DO NOTHING;--> statement-breakpoint

INSERT INTO "product_content_items" (
  "product_id", "type", "title", "source_url", "video_provider", "position",
  "published", "legacy_masterclass_lesson_id", "created_at", "updated_at"
)
SELECT
  p."id", 'video', ml."title", ml."video_asset_id", ml."video_provider",
  ml."position" * 100, ml."published", ml."id", ml."created_at", ml."updated_at"
FROM "masterclass_lessons" ml
JOIN "products" p ON p."legacy_masterclass_course_id" = ml."course_id"
ON CONFLICT ("product_id", "position") DO NOTHING;--> statement-breakpoint

INSERT INTO "product_content_items" (
  "product_id", "type", "title", "source_url", "position", "published",
  "legacy_masterclass_lesson_id", "created_at", "updated_at"
)
SELECT
  p."id", 'external_link', ml."support_material_title",
  ml."support_material_url", ml."position" * 100 + 1, ml."published", ml."id",
  ml."created_at", ml."updated_at"
FROM "masterclass_lessons" ml
JOIN "products" p ON p."legacy_masterclass_course_id" = ml."course_id"
WHERE ml."support_material_url" IS NOT NULL
  AND ml."support_material_title" IS NOT NULL
ON CONFLICT ("product_id", "position") DO NOTHING;--> statement-breakpoint

WITH material_rows AS (
  SELECT
    mm.*, ml."course_id", ml."position" AS lesson_position,
    row_number() OVER (
      PARTITION BY mm."lesson_id" ORDER BY mm."created_at", mm."id"
    ) AS material_position
  FROM "masterclass_materials" mm
  JOIN "masterclass_lessons" ml ON ml."id" = mm."lesson_id"
)
INSERT INTO "product_content_items" (
  "product_id", "type", "title", "source_url", "filename", "mime_type",
  "position", "published", "legacy_masterclass_lesson_id", "created_at",
  "updated_at"
)
SELECT
  p."id",
  CASE WHEN mr."mime_type" = 'application/pdf' THEN 'pdf' ELSE 'file' END,
  mr."title", mr."blob_url", mr."filename", mr."mime_type",
  mr.lesson_position * 100 + 10 + mr.material_position, true, mr."lesson_id",
  mr."created_at", mr."created_at"
FROM material_rows mr
JOIN "products" p ON p."legacy_masterclass_course_id" = mr."course_id"
ON CONFLICT ("product_id", "position") DO NOTHING;

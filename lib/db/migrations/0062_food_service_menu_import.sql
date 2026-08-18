ALTER TABLE "food_service_menus" ADD CONSTRAINT "food_service_menus_id_company_unique" UNIQUE ("id", "company_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "location_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "normalized_url" text NOT NULL,
  "provider" varchar NOT NULL,
  "adapter_version" varchar(80) NOT NULL,
  "status" varchar NOT NULL DEFAULT 'queued',
  "idempotency_key" varchar(200) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "source_fingerprint" varchar(64),
  "source_document" jsonb,
  "workflow_run_id" varchar(255),
  "attempt_count" integer NOT NULL DEFAULT 0,
  "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_code" varchar(120),
  "error_detail" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_import_jobs_id_company_menu_unique" UNIQUE ("id", "company_id", "menu_id"),
  CONSTRAINT "food_service_menu_import_jobs_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_jobs_location_company_fk" FOREIGN KEY ("location_id", "company_id") REFERENCES "company_locations"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_jobs_provider_check" CHECK ("provider" IN ('anota_ai', 'brendi', 'ifood', 'generic_web')),
  CONSTRAINT "food_service_menu_import_jobs_status_check" CHECK ("status" IN ('queued', 'extracting', 'normalizing', 'analyzing', 'needs_review', 'ready', 'publishing', 'published', 'failed', 'cancelled')),
  CONSTRAINT "food_service_menu_import_jobs_terminal_timestamp_check" CHECK (("status" IN ('published', 'failed', 'cancelled') AND "completed_at" IS NOT NULL) OR ("status" NOT IN ('published', 'failed', 'cancelled') AND "completed_at" IS NULL)),
  CONSTRAINT "food_service_menu_import_jobs_attempt_count_check" CHECK ("attempt_count" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_import_jobs_company_idempotency_unique" ON "food_service_menu_import_jobs"("company_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "food_service_menu_import_jobs_company_status_idx" ON "food_service_menu_import_jobs"("company_id", "status", "created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_import_drafts" (
  "job_id" uuid PRIMARY KEY,
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "schema_version" integer NOT NULL,
  "revision" integer NOT NULL DEFAULT 1,
  "document" jsonb NOT NULL,
  "resolved_mappings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "document_fingerprint" varchar(64) NOT NULL,
  "validation_summary" jsonb NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_import_drafts_job_company_menu_unique" UNIQUE ("job_id", "company_id", "menu_id"),
  CONSTRAINT "food_service_menu_import_drafts_job_company_menu_fk" FOREIGN KEY ("job_id", "company_id", "menu_id") REFERENCES "food_service_menu_import_jobs"("id", "company_id", "menu_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_drafts_revision_check" CHECK ("revision" > 0 AND "schema_version" > 0)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_import_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "field_path" text NOT NULL,
  "code" varchar(120) NOT NULL,
  "severity" varchar NOT NULL,
  "message" text NOT NULL,
  "confidence_basis_points" integer NOT NULL,
  "status" varchar NOT NULL DEFAULT 'open',
  "resolution" text,
  "resolved_by_user_id" uuid REFERENCES "users"("id"),
  "resolved_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_import_issues_draft_company_menu_fk" FOREIGN KEY ("job_id", "company_id", "menu_id") REFERENCES "food_service_menu_import_drafts"("job_id", "company_id", "menu_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_issues_severity_check" CHECK ("severity" IN ('blocking', 'warning')),
  CONSTRAINT "food_service_menu_import_issues_status_check" CHECK ("status" IN ('open', 'resolved')),
  CONSTRAINT "food_service_menu_import_issues_confidence_check" CHECK ("confidence_basis_points" BETWEEN 0 AND 10000),
  CONSTRAINT "food_service_menu_import_issues_resolution_check" CHECK (("status" = 'open' AND "resolution" IS NULL AND "resolved_by_user_id" IS NULL AND "resolved_at" IS NULL) OR ("status" = 'resolved' AND "resolution" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL AND "resolved_at" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_menu_import_issues_job_status_idx" ON "food_service_menu_import_issues"("job_id", "status", "severity");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_import_blobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "content_hash" varchar(64) NOT NULL,
  "generation_id" uuid NOT NULL,
  "blob_url" text,
  "blob_etag" varchar(256),
  "pathname" text NOT NULL,
  "mime_type" varchar NOT NULL,
  "byte_size" integer NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "attempt_token" uuid NOT NULL,
  "status" varchar NOT NULL DEFAULT 'uploading',
  "lease_expires_at" timestamp,
  "referenced_at" timestamp,
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_import_blobs_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_blobs_job_company_menu_fk" FOREIGN KEY ("job_id", "company_id", "menu_id") REFERENCES "food_service_menu_import_jobs"("id", "company_id", "menu_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_import_blobs_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "food_service_menu_import_blobs_bounds_check" CHECK ("byte_size" BETWEEN 1 AND 8388608 AND "width" BETWEEN 1 AND 8192 AND "height" BETWEEN 1 AND 8192 AND "width"::bigint * "height"::bigint <= 40000000),
  CONSTRAINT "food_service_menu_import_blobs_status_check" CHECK ("status" IN ('uploading', 'temporary', 'referenced', 'deleting', 'deleted')),
  CONSTRAINT "food_service_menu_import_blobs_mime_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "food_service_menu_import_blobs_lifecycle_check" CHECK (("status" = 'uploading' AND "blob_url" IS NULL AND "blob_etag" IS NULL AND "lease_expires_at" IS NOT NULL AND "referenced_at" IS NULL AND "deleted_at" IS NULL) OR ("status" = 'temporary' AND "blob_url" IS NOT NULL AND "blob_etag" IS NOT NULL AND "lease_expires_at" IS NULL AND "referenced_at" IS NULL AND "deleted_at" IS NULL) OR ("status" = 'referenced' AND "blob_url" IS NOT NULL AND "blob_etag" IS NOT NULL AND "pathname" IS NOT NULL AND "lease_expires_at" IS NULL AND "referenced_at" IS NOT NULL AND "deleted_at" IS NULL) OR ("status" = 'deleting' AND "blob_url" IS NOT NULL AND "blob_etag" IS NOT NULL AND "referenced_at" IS NULL AND "deleted_at" IS NULL) OR ("status" = 'deleted' AND "blob_url" IS NULL AND "blob_etag" IS NULL AND "lease_expires_at" IS NULL AND "referenced_at" IS NULL AND "deleted_at" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_import_blobs_scope_hash_unique" ON "food_service_menu_import_blobs"("company_id", "menu_id", "content_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_import_blobs_blob_url_unique" ON "food_service_menu_import_blobs"("blob_url");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_import_blobs_pathname_unique" ON "food_service_menu_import_blobs"("pathname");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "food_service_menu_import_blobs_cleanup_idx" ON "food_service_menu_import_blobs"("status", "updated_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_catalog_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "source_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "warning_summary" jsonb NOT NULL DEFAULT '{"imageFailures":{"count":0,"acknowledged":false,"byCode":{}}}'::jsonb,
  "fingerprint" varchar(64) NOT NULL,
  "origin" varchar NOT NULL,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "source_job_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_catalog_versions_menu_sequence_unique" UNIQUE ("menu_id", "sequence"),
  CONSTRAINT "food_service_menu_catalog_versions_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_catalog_versions_source_job_company_menu_fk" FOREIGN KEY ("source_job_id", "company_id", "menu_id") REFERENCES "food_service_menu_import_jobs"("id", "company_id", "menu_id"),
  CONSTRAINT "food_service_menu_catalog_versions_origin_check" CHECK ("origin" IN ('imported', 'restored')),
  CONSTRAINT "food_service_menu_catalog_versions_sequence_check" CHECK ("sequence" > 0)
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_food_service_menu_catalog_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'food_service_menu_catalog_versions is append-only';
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "food_service_menu_catalog_versions_append_only" ON "food_service_menu_catalog_versions";
CREATE TRIGGER "food_service_menu_catalog_versions_append_only" BEFORE UPDATE OR DELETE ON "food_service_menu_catalog_versions" FOR EACH ROW EXECUTE FUNCTION prevent_food_service_menu_catalog_version_mutation();--> statement-breakpoint
DROP TRIGGER IF EXISTS "food_service_menu_catalog_versions_no_truncate" ON "food_service_menu_catalog_versions";
CREATE TRIGGER "food_service_menu_catalog_versions_no_truncate" BEFORE TRUNCATE ON "food_service_menu_catalog_versions" FOR EACH STATEMENT EXECUTE FUNCTION prevent_food_service_menu_catalog_version_mutation();--> statement-breakpoint

CREATE OR REPLACE FUNCTION retain_food_service_menu_catalog_versions_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM food_service_menu_catalog_versions
  WHERE id IN (
    SELECT id
    FROM food_service_menu_catalog_versions
    WHERE company_id = NEW.company_id AND menu_id = NEW.menu_id
    ORDER BY sequence DESC
    OFFSET 5
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "food_service_menu_catalog_versions_retain_five" ON "food_service_menu_catalog_versions";
CREATE TRIGGER "food_service_menu_catalog_versions_retain_five" AFTER INSERT ON "food_service_menu_catalog_versions" FOR EACH ROW EXECUTE FUNCTION retain_food_service_menu_catalog_versions_after_insert();--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_catalog_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "operation_key" varchar(200) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "origin" varchar NOT NULL,
  "version_id" uuid NOT NULL,
  "version_sequence" integer NOT NULL,
  "version_fingerprint" varchar(64) NOT NULL,
  "source_job_id" uuid,
  "source_version_id" uuid,
  "failed_image_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_catalog_operations_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_catalog_operations_origin_check" CHECK ("origin" IN ('imported', 'restored')),
  CONSTRAINT "food_service_menu_catalog_operations_sequence_check" CHECK ("version_sequence" > 0 AND "failed_image_count" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_catalog_operations_operation_key_unique" ON "food_service_menu_catalog_operations"("company_id", "menu_id", "operation_key");--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_food_service_menu_catalog_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'food_service_menu_catalog_operations is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "food_service_menu_catalog_operations_append_only" BEFORE UPDATE OR DELETE ON "food_service_menu_catalog_operations" FOR EACH ROW EXECUTE FUNCTION prevent_food_service_menu_catalog_operation_mutation();--> statement-breakpoint
CREATE TRIGGER "food_service_menu_catalog_operations_no_truncate" BEFORE TRUNCATE ON "food_service_menu_catalog_operations" FOR EACH STATEMENT EXECUTE FUNCTION prevent_food_service_menu_catalog_operation_mutation();--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "food_service_menu_source_refs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "menu_id" uuid NOT NULL,
  "provider" varchar NOT NULL,
  "entity_type" varchar NOT NULL,
  "external_id" varchar(200) NOT NULL,
  "local_entity_type" varchar NOT NULL,
  "local_entity_id" uuid NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "food_service_menu_source_refs_menu_company_fk" FOREIGN KEY ("menu_id", "company_id") REFERENCES "food_service_menus"("id", "company_id") ON DELETE CASCADE,
  CONSTRAINT "food_service_menu_source_refs_provider_check" CHECK ("provider" IN ('anota_ai', 'brendi', 'ifood', 'generic_web')),
  CONSTRAINT "food_service_menu_source_refs_entity_type_check" CHECK ("entity_type" IN ('category', 'item', 'option_group', 'option') AND "local_entity_type" IN ('category', 'item', 'option_group', 'option'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_source_refs_external_identity_unique" ON "food_service_menu_source_refs"("company_id", "menu_id", "provider", "entity_type", "external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "food_service_menu_source_refs_local_identity_unique" ON "food_service_menu_source_refs"("company_id", "menu_id", "provider", "local_entity_type", "local_entity_id");

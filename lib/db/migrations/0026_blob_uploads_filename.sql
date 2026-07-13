-- Device media library: store the original device filename so the library can
-- list uploads by a human name (the blob pathname carries a random suffix).
-- See automatize-frontend/docs/adr/0021-device-media-7-day-retention.md
--
-- Additive + nullable: pre-existing rows keep NULL and fall back to the blob
-- pathname basename in the API. No data is lost or rewritten.
--
-- This file is byte-identical to backoffice/lib/db/migrations/0026_blob_uploads_filename.sql
-- so a single sha256 covers both journals in the shared drizzle.__drizzle_migrations.

ALTER TABLE "blob_uploads" ADD COLUMN IF NOT EXISTS "filename" text;

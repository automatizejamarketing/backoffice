-- Biblioteca de mídias (spec 2026-10-13): quem subiu (admin do backoffice ou o
-- próprio cliente), tamanho lido do R2 e motivo da exclusão. Só colunas novas e
-- nulas — nenhuma linha existente é reescrita.
-- Shared FE 0141 / BO 0132, same `when` (1802100000000): first apply wins.

ALTER TABLE "blob_uploads" ADD COLUMN IF NOT EXISTS "size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "blob_uploads" ADD COLUMN IF NOT EXISTS "uploaded_by_backoffice_email" varchar(255);--> statement-breakpoint
ALTER TABLE "blob_uploads" ADD COLUMN IF NOT EXISTS "deleted_reason" varchar(20);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blob_uploads_media_library_idx" ON "blob_uploads" USING btree ("user_id","created_at" DESC,"id" DESC) WHERE "source" = 'campaign_media' AND "deleted_at" IS NULL;

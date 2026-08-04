-- Optional max clip length (seconds) for Creatomate video templates.
ALTER TABLE "video_templates" ADD COLUMN IF NOT EXISTS "max_duration" integer;

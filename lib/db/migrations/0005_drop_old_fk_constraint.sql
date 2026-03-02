-- Drop the old FK constraint that still references the posts table
ALTER TABLE "backoffice_generated_posts" DROP CONSTRAINT IF EXISTS "backoffice_generated_posts_source_user_post_id_posts_id_fk";

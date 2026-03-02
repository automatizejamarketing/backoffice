CREATE TABLE "ai_generated_image_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"parent_version_id" uuid,
	"generated_image_id" uuid NOT NULL,
	"source_ai_generated_image_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backoffice_generated_posts" DROP CONSTRAINT "backoffice_generated_posts_source_user_post_id_posts_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_generated_image_versions" ADD CONSTRAINT "ai_generated_image_versions_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_image_versions" ADD CONSTRAINT "ai_generated_image_versions_source_ai_generated_image_id_ai_generated_images_id_fk" FOREIGN KEY ("source_ai_generated_image_id") REFERENCES "public"."ai_generated_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generated_image_versions" ADD CONSTRAINT "ai_generated_image_versions_parent_version_id_ai_generated_image_versions_id_fk" FOREIGN KEY ("parent_version_id") REFERENCES "public"."ai_generated_image_versions"("id") ON DELETE no action ON UPDATE no action;
-- Backoffice admins use Google OAuth (session user id is OAuth sub), not users.id UUIDs.
-- Store admin email like backoffice_audit_logs; drop invalid FK on backoffice_user_id.
ALTER TABLE "adset_edit_logs" DROP CONSTRAINT "adset_edit_logs_backoffice_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "backoffice_user_email" varchar(100);--> statement-breakpoint
UPDATE "adset_edit_logs" AS a
SET "backoffice_user_email" = u."email"
FROM "users" AS u
WHERE u."id" = a."backoffice_user_id";--> statement-breakpoint
UPDATE "adset_edit_logs"
SET "backoffice_user_email" = 'legacy@unknown'
WHERE "backoffice_user_email" IS NULL;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ALTER COLUMN "backoffice_user_email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" DROP COLUMN "backoffice_user_id";

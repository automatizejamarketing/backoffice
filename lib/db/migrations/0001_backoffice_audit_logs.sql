CREATE TABLE "backoffice_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_email" varchar(100) NOT NULL,
	"target_user_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"field_name" varchar(50) NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backoffice_audit_logs" ADD CONSTRAINT "backoffice_audit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
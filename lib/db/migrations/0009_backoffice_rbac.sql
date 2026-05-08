CREATE TABLE IF NOT EXISTS "backoffice_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(100) NOT NULL,
	"name" varchar(100),
	"role" varchar DEFAULT 'marketing_consultant' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "backoffice_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_marketing_consultants" (
	"user_id" uuid NOT NULL,
	"consultant_id" uuid NOT NULL,
	"assigned_by_email" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_marketing_consultants_user_id_pk" PRIMARY KEY("user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_marketing_consultants_consultant_id_idx" ON "user_marketing_consultants" ("consultant_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_marketing_consultants" ADD CONSTRAINT "user_marketing_consultants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_marketing_consultants" ADD CONSTRAINT "user_marketing_consultants_consultant_id_backoffice_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."backoffice_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

CREATE TABLE "backoffice_magic_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(100) NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "backoffice_magic_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "backoffice_users" (
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
CREATE TABLE "user_marketing_consultants" (
	"user_id" uuid NOT NULL,
	"consultant_id" uuid NOT NULL,
	"assigned_by_email" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_marketing_consultants_user_id_pk" PRIMARY KEY("user_id")
);
--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "previous_start_time" text;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "new_start_time" text;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "previous_end_time" text;--> statement-breakpoint
ALTER TABLE "adset_edit_logs" ADD COLUMN "new_end_time" text;--> statement-breakpoint
ALTER TABLE "campaign_edit_logs" ADD COLUMN "adset_schedule_changes" jsonb;--> statement-breakpoint
ALTER TABLE "user_marketing_consultants" ADD CONSTRAINT "user_marketing_consultants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_marketing_consultants" ADD CONSTRAINT "user_marketing_consultants_consultant_id_backoffice_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."backoffice_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backoffice_magic_links_email_idx" ON "backoffice_magic_links" USING btree ("email");
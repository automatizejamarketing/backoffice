ALTER TABLE "affiliates" ADD COLUMN "blocked_by" varchar(100);--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "blocked_at" timestamp;--> statement-breakpoint
CREATE TABLE "affiliate_action_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"admin_email" varchar(100) NOT NULL,
	"action" varchar NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "affiliate_action_logs" ADD CONSTRAINT "affiliate_action_logs_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."affiliates"("id") ON DELETE no action ON UPDATE no action;

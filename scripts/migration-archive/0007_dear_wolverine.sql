ALTER TABLE "subscriptions" ADD COLUMN "commitment_end_date" timestamp;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "commitment_months" integer DEFAULT 1 NOT NULL;
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "pix_renewal_opt_out_at" timestamp;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cancellation_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "subscription_id" uuid REFERENCES "subscriptions"("id"),
  "provider" varchar NOT NULL,
  "plan_type" varchar NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "status" varchar DEFAULT 'started' NOT NULL,
  "reason" varchar(64),
  "reason_details" text,
  "offer_type" varchar(64),
  "offer_version" varchar(64),
  "offer_percent" integer,
  "decision" varchar,
  "decision_at" timestamp,
  "outcome" varchar,
  "outcome_at" timestamp
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cancellation_attempts_started_idx"
  ON "cancellation_attempts" ("started_at", "provider", "plan_type");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cancellation_attempt_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "attempt_id" uuid NOT NULL REFERENCES "cancellation_attempts"("id"),
  "event_type" varchar(64) NOT NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "operation_key" varchar(255),
  "details" jsonb
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "cancellation_attempt_events_operation_unique"
  ON "cancellation_attempt_events" ("operation_key")
  WHERE "operation_key" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "retention_financial_benefits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "attempt_id" uuid NOT NULL REFERENCES "cancellation_attempts"("id"),
  "status" varchar DEFAULT 'reserved' NOT NULL,
  "benefit_type" varchar(64) NOT NULL,
  "campaign_id" varchar(128) NOT NULL,
  "campaign_version" varchar(64) NOT NULL,
  "provider" varchar NOT NULL,
  "plan_type" varchar NOT NULL,
  "subscription_id" uuid REFERENCES "subscriptions"("id"),
  "original_amount" integer NOT NULL,
  "discount_percent" integer NOT NULL,
  "discount_amount" integer NOT NULL,
  "provider_coupon_id" varchar(255),
  "provider_payment_id" varchar(255),
  "provider_invoice_id" varchar(255),
  "reserved_at" timestamp DEFAULT now() NOT NULL,
  "applied_at" timestamp,
  "consumed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "retention_financial_benefits_user_id_unique"
  ON "retention_financial_benefits" ("user_id");--> statement-breakpoint

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "retention_benefit_id" uuid REFERENCES "retention_financial_benefits"("id");--> statement-breakpoint

ALTER TABLE "mercadopago_payment_links"
  ADD COLUMN IF NOT EXISTS "retention_benefit_id" uuid REFERENCES "retention_financial_benefits"("id"),
  ADD COLUMN IF NOT EXISTS "original_amount" integer,
  ADD COLUMN IF NOT EXISTS "discount_percent" integer,
  ADD COLUMN IF NOT EXISTS "discount_amount" integer;

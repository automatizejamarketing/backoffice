CREATE TABLE "product_refund_balance_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" uuid NOT NULL REFERENCES "product_payments"("id"),
  "expert_id" uuid REFERENCES "expert_profiles"("id"),
  "responsible" varchar NOT NULL,
  "status" varchar DEFAULT 'pending' NOT NULL,
  "first_failed_at" timestamp NOT NULL,
  "last_failed_at" timestamp NOT NULL,
  "regularization_due_at" timestamp NOT NULL,
  "notice_sent_at" timestamp NOT NULL,
  "released_by_user_id" uuid REFERENCES "users"("id"),
  "released_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_refund_balance_cases_payment_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE INDEX "product_refund_balance_cases_expert_pause_idx" ON "product_refund_balance_cases" USING btree ("expert_id", "status", "regularization_due_at");

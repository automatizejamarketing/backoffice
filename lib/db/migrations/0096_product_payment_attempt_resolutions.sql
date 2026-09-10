CREATE TABLE IF NOT EXISTS "product_payment_attempt_resolutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "attempt_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "attempt_key" varchar(80) NOT NULL,
  "provider" varchar(30) NOT NULL,
  "outcome" varchar(20) NOT NULL,
  "operator_email" varchar(255) NOT NULL,
  "reason" text NOT NULL,
  "provider_fact" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_payment_attempt_resolutions_attempt_id_product_payment_attempts_id_fk"
    FOREIGN KEY ("attempt_id") REFERENCES "product_payment_attempts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "product_payment_attempt_resolutions_order_id_product_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "product_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_payment_attempt_resolutions_attempt_unique"
  ON "product_payment_attempt_resolutions" ("attempt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_payment_attempt_resolutions_order_created_idx"
  ON "product_payment_attempt_resolutions" ("order_id", "created_at");

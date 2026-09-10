CREATE TABLE IF NOT EXISTS "product_payment_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "attempt_key" varchar(80) NOT NULL,
  "request_fingerprint" varchar(64) NOT NULL,
  "order_id" uuid NOT NULL,
  "provider" varchar(30) DEFAULT 'mercadopago' NOT NULL,
  "checkout_model" varchar(60) NOT NULL,
  "payment_method" varchar(10) NOT NULL,
  "amount_centavos" integer NOT NULL,
  "buyer_total_centavos" integer,
  "buyer_interest_centavos" integer,
  "installments" integer,
  "payment_method_id" varchar(80),
  "issuer_id" varchar(80),
  "product_offer_id" varchar(100),
  "mercadopago_collector_id" varchar(64),
  "expected_provider_fee_centavos" integer,
  "expected_application_fee_centavos" integer,
  "split_contract_version" varchar(80),
  "payload_snapshot" jsonb NOT NULL,
  "provider_payment_id" varchar(255),
  "status" varchar(20) DEFAULT 'prepared' NOT NULL,
  "failure_code" varchar(120),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "issued_at" timestamp,
  "terminal_at" timestamp,
  "last_checked_at" timestamp,
  CONSTRAINT "product_payment_attempts_order_id_product_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "product_orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_payment_attempts_attempt_key_unique" ON "product_payment_attempts" ("attempt_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_payment_attempts_provider_payment_unique" ON "product_payment_attempts" ("provider", "provider_payment_id") WHERE "provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_payment_attempts_order_created_idx" ON "product_payment_attempts" ("order_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_payment_attempts_order_status_idx" ON "product_payment_attempts" ("order_id", "status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_payment_attempts_one_active_order_unique" ON "product_payment_attempts" ("order_id") WHERE "status" IN ('prepared', 'issuing', 'pending', 'unknown');--> statement-breakpoint
ALTER TABLE "product_payments" ADD COLUMN IF NOT EXISTS "attempt_id" uuid REFERENCES "product_payment_attempts"("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_payments_attempt_id_idx" ON "product_payments" ("attempt_id");

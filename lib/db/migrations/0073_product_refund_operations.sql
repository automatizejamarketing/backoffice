ALTER TABLE "product_payments" ADD COLUMN "refunded_amount_centavos" integer;

CREATE TABLE "product_refund_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" uuid NOT NULL REFERENCES "product_payments"("id"),
  "operator_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "idempotency_key" varchar(128) NOT NULL,
  "provider_refund_id" varchar(255),
  "status" varchar DEFAULT 'issuing' NOT NULL,
  "refunded_amount_centavos" integer DEFAULT 0 NOT NULL,
  "failure_reason" text,
  "attempted_at" timestamp DEFAULT now() NOT NULL,
  "confirmed_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_refund_operations_payment_unique" UNIQUE("payment_id"),
  CONSTRAINT "product_refund_operations_idempotency_unique" UNIQUE("idempotency_key")
);

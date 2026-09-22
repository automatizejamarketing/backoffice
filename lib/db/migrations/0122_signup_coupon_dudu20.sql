CREATE TABLE IF NOT EXISTS "signup_coupon_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "code" varchar(32) NOT NULL,
  "status" varchar(16) NOT NULL,
  "provider" varchar(16) NOT NULL,
  "plan_type" varchar NOT NULL,
  "original_amount" integer NOT NULL,
  "discount_percent" integer NOT NULL,
  "discount_amount" integer NOT NULL,
  "final_amount" integer NOT NULL,
  "stripe_subscription_id" varchar(255),
  "stripe_invoice_id" varchar(255),
  "mercadopago_payment_link_id" uuid,
  "reserved_at" timestamp DEFAULT now() NOT NULL,
  "consumed_at" timestamp,
  "released_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "signup_coupon_redemptions_pending_user_code"
  ON "signup_coupon_redemptions" ("user_id", "code")
  WHERE "status" = 'pending';--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "signup_coupon_redemptions_consumed_user_code"
  ON "signup_coupon_redemptions" ("user_id", "code")
  WHERE "status" = 'consumed';

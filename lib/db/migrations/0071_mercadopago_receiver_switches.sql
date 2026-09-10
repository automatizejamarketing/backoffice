CREATE TABLE "mercado_pago_expert_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expert_id" uuid NOT NULL REFERENCES "expert_profiles"("id"),
  "mp_user_id" varchar(64) NOT NULL,
  "environment" varchar NOT NULL,
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text NOT NULL,
  "token_expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mercado_pago_expert_accounts_expert_user_environment_unique" UNIQUE("expert_id", "mp_user_id", "environment")
);
CREATE TABLE "mercado_pago_receiver_switches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expert_id" uuid NOT NULL REFERENCES "expert_profiles"("id"),
  "environment" varchar NOT NULL,
  "previous_mp_user_id" varchar(64) NOT NULL,
  "next_mp_user_id" varchar(64),
  "state" varchar DEFAULT 'authorized' NOT NULL,
  "authorized_by" varchar(255) NOT NULL,
  "authorized_at" timestamp DEFAULT now() NOT NULL,
  "activated_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mercado_pago_receiver_switches_expert_environment_unique" UNIQUE("expert_id", "environment")
);
ALTER TABLE "product_payments" ADD COLUMN "mercadopago_collector_id" varchar(64);

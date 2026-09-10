CREATE TABLE "mercado_pago_expert_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expert_id" uuid NOT NULL REFERENCES "expert_profiles"("id"),
  "mp_user_id" varchar(64) NOT NULL,
  "environment" varchar NOT NULL,
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text NOT NULL,
  "token_expires_at" timestamp NOT NULL,
  "scopes" text,
  "pix_status" varchar DEFAULT 'unknown' NOT NULL,
  "card_status" varchar DEFAULT 'unknown' NOT NULL,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mercado_pago_expert_connections_expert_environment_unique" UNIQUE("expert_id", "environment"),
  CONSTRAINT "mercado_pago_expert_connections_user_environment_unique" UNIQUE("mp_user_id", "environment")
);
CREATE TABLE "mercado_pago_oauth_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expert_id" uuid NOT NULL REFERENCES "expert_profiles"("id"),
  "environment" varchar NOT NULL,
  "state_hash" varchar(64) NOT NULL,
  "code_verifier_encrypted" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mercado_pago_oauth_attempts_state_hash_unique" UNIQUE("state_hash")
);
CREATE INDEX "mercado_pago_oauth_attempts_expert_idx" ON "mercado_pago_oauth_attempts" ("expert_id", "expires_at");

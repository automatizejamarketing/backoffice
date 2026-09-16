-- Partner-access diagnosis + admin-assisted Meta reconnect.
-- Mirrored in the frontend as 0112_meta_partner_access, with the SAME `when`
-- (1799400000000): whoever migrates first applies; the other skips.


ALTER TABLE "meta_business_accounts"
  ADD COLUMN IF NOT EXISTS "partner_access_status" varchar(32);--> statement-breakpoint

ALTER TABLE "meta_business_accounts"
  ADD COLUMN IF NOT EXISTS "partner_access_diagnosis" jsonb;--> statement-breakpoint

ALTER TABLE "meta_business_accounts"
  ADD COLUMN IF NOT EXISTS "partner_access_checked_at" timestamp;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "meta_admin_oauth_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "target_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "actor_admin_id" text NOT NULL,
  "actor_admin_email" text NOT NULL,
  "state_hash" text NOT NULL,
  "auth_mode" varchar(16) DEFAULT 'user' NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "result" varchar(32),
  "audit" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "meta_admin_oauth_attempts_state_hash_unique"
  ON "meta_admin_oauth_attempts" ("state_hash");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "meta_admin_oauth_attempts_target_user_id_idx"
  ON "meta_admin_oauth_attempts" ("target_user_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "meta_admin_oauth_attempts_expires_at_idx"
  ON "meta_admin_oauth_attempts" ("expires_at");

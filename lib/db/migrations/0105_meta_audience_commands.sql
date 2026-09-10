CREATE TABLE IF NOT EXISTS "meta_audience_commands" (
  "command_id" text PRIMARY KEY NOT NULL,
  "actor_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "account_id" text NOT NULL,
  "audience_id" text NOT NULL,
  "request" jsonb NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "result" jsonb,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_audience_commands_expiry_idx" ON "meta_audience_commands" ("expires_at");

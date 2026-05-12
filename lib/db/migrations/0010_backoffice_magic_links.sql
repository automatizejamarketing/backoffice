CREATE TABLE IF NOT EXISTS "backoffice_magic_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(100) NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "backoffice_magic_links_token_hash_unique" UNIQUE("token_hash")
);

CREATE INDEX IF NOT EXISTS "backoffice_magic_links_email_idx"
  ON "backoffice_magic_links" ("email");

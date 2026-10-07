-- Agências (ADR 0041): empresa que opera os negócios dos seus clientes no
-- Automatize. Membros com papel (owner = Dono da Agência, member = Membro).
-- Convites são links: só o hash SHA-256 do token fica no banco; o link vale
-- até `expires_at`, uma vez. O backoffice convida o Dono; o Dono convida
-- Membros. Papéis vivem no catálogo em TypeScript, sem CHECK no banco.
-- Shared FE 0136 / BO 0129, same `when` (1801600000000): first apply wins.

CREATE TABLE IF NOT EXISTS "agencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "archived_at" timestamp with time zone,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agency_members" (
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role" varchar(16) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("agency_id", "user_id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agency_members_user_idx"
  ON "agency_members" ("user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agency_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "email" varchar(320) NOT NULL,
  "role" varchar(16) NOT NULL,
  "token_hash" varchar(64) NOT NULL,
  "invited_by_user_id" uuid REFERENCES "users"("id"),
  "invited_by_backoffice_user_id" uuid REFERENCES "backoffice_users"("id"),
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "accepted_by_user_id" uuid REFERENCES "users"("id"),
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "agency_invitations_token_hash_unique"
  ON "agency_invitations" ("token_hash");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agency_invitations_agency_idx"
  ON "agency_invitations" ("agency_id", "created_at");

-- Escopo de Agência no backoffice (ADR 0044/0045): agências, a agência de cada pessoa da equipe
-- (null = Automatize) e a conta de cada Cliente da Agência. Só aditivo; os cargos agency_owner e
-- agency_member entram em backoffice_users.role sem DDL (varchar sem CHECK).
-- Shared BO 0136 / FE 0145, same `when` (1802400000000): first apply wins.

CREATE TABLE IF NOT EXISTS "agencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(120) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);--> statement-breakpoint

ALTER TABLE "backoffice_users" ADD COLUMN IF NOT EXISTS "agency_id" uuid REFERENCES "agencies"("id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agency_clients" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "agency_id" uuid NOT NULL REFERENCES "agencies"("id"),
  "added_by_email" varchar(100) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agency_clients_agency_id_idx" ON "agency_clients" USING btree ("agency_id");

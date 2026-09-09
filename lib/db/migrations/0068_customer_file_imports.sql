-- Persistência operacional das importações de lista de clientes (ticket 21).
-- Gêmea de `frontend/0075_customer_file_imports` e
-- `backoffice/0068_customer_file_imports`, com o MESMO `when` (1795300000000).
-- A marca d'água de `drizzle.__drizzle_migrations` é compartilhada: quem
-- migrar primeiro aplica e o outro pula, o que só é seguro porque o DDL é
-- o mesmo. Os dois arquivos precisam ser IDÊNTICOS, comentários inclusive.
--
-- Aditivo. Acima da marca de frontend/0074 e backoffice/0067 (1795200000000).
-- Contatos, hashes e amostras vivem só em customer_file_temporary_material.

CREATE TABLE IF NOT EXISTS "customer_file_operations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "actor_kind" varchar(32) DEFAULT 'user' NOT NULL,
  "actor_id" uuid,
  "customer_id" uuid,
  "ad_account_id" text,
  "audience_identity" text NOT NULL,
  "audience_id" text,
  "audience_name" text,
  "operation_type" varchar(16) NOT NULL,
  "state" varchar(32) NOT NULL,
  "received_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "preview_confirmed" boolean DEFAULT false NOT NULL,
  "declarations_confirmed" boolean DEFAULT false NOT NULL,
  "customer_file_source" text,
  "counts" text DEFAULT '{}' NOT NULL,
  "session_id" text,
  "session_started_at" timestamp,
  "confirmed_batches" text DEFAULT '[]' NOT NULL,
  "receipts" text DEFAULT '[]' NOT NULL,
  "pending_unresolved" boolean DEFAULT false NOT NULL,
  "name" text,
  "description" text,
  CONSTRAINT "customer_file_operations_customer_id_users_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "customer_file_operations_customer_idx"
  ON "customer_file_operations" ("customer_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "customer_file_operations_audience_idx"
  ON "customer_file_operations" ("audience_identity");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "customer_file_operations_state_idx"
  ON "customer_file_operations" ("state");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "customer_file_coordination" (
  "audience_identity" text PRIMARY KEY NOT NULL,
  "operation_id" uuid NOT NULL,
  "executor_token" text,
  "lease_until" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "customer_file_temporary_material" (
  "operation_id" uuid PRIMARY KEY NOT NULL,
  "received_at" timestamp NOT NULL,
  "expires_at" timestamp NOT NULL,
  "raw_file" text,
  "normalized_rows" text,
  "hashes" text,
  "error_samples" text,
  "correction_report" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "customer_file_temporary_material_operation_id_fk"
    FOREIGN KEY ("operation_id") REFERENCES "public"."customer_file_operations"("id") ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "customer_file_temporary_expires_idx"
  ON "customer_file_temporary_material" ("expires_at");--> statement-breakpoint

-- Coordination has no user FK (acquire may precede the first save). When the
-- customer row is removed, operations cascade; this trigger frees the audience.
CREATE OR REPLACE FUNCTION customer_file_cleanup_coordination()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM customer_file_coordination WHERE operation_id = OLD.id;
  RETURN OLD;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS customer_file_operations_cleanup_coordination
  ON customer_file_operations;--> statement-breakpoint

CREATE TRIGGER customer_file_operations_cleanup_coordination
AFTER DELETE ON customer_file_operations
FOR EACH ROW
EXECUTE PROCEDURE customer_file_cleanup_coordination();

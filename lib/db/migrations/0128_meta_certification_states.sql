-- Estado da certificação Meta (100/2859024) por cliente: resultado do teste
-- validate_only do BISU logo após a conexão e o token pessoal de reserva que o
-- cliente conecta quando o BISU é recusado. Um registro por cliente.
-- Shared FE 0135 / BO 0128, same `when` (1801500000000): first apply wins.

CREATE TABLE IF NOT EXISTS "meta_certification_states" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connection_id" text,
  "connection_updated_at" timestamp,
  "bisu_status" varchar(32),
  "bisu_checked_at" timestamp,
  "bisu_detail" jsonb,
  "personal_facebook_user_id" text,
  "personal_access_token" text,
  "personal_token_expires_at" timestamp,
  "personal_status" varchar(32),
  "personal_checked_at" timestamp,
  "personal_detail" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

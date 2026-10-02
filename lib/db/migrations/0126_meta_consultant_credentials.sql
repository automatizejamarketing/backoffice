-- Credencial pessoal do consultor, guardada à parte da conexão BISU do cliente
-- para servir de fallback quando a Meta recusa a publicação por certificação.
-- Shared FE 0133 / BO 0126, same `when` (1801400000000): first apply wins.

CREATE TABLE IF NOT EXISTS "meta_consultant_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "facebook_user_id" text NOT NULL,
  "actor_admin_id" text NOT NULL,
  "actor_admin_email" text NOT NULL,
  "name" text,
  "access_token" text NOT NULL,
  "token_expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "meta_consultant_credentials_facebook_user_id_unique" UNIQUE ("facebook_user_id")
);

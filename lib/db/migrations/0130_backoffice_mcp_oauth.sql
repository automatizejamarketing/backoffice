-- MCP do backoffice: servidor OAuth 2.1 próprio para colaboradores (não clientes).
-- O Claude se registra como cliente, o colaborador consente logado no backoffice e
-- `/api/mcp` aceita o bearer emitido. A permissão é relida pelo e-mail a cada chamada.
-- Segredos guardados com hash; uma linha de token é um grant.
-- Shared FE 0137 / BO 0130, same `when` (1801700000000): first apply wins.
CREATE TABLE IF NOT EXISTS "backoffice_mcp_oauth_clients" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "client_name" varchar(200) NOT NULL,
  "client_secret_hash" varchar(64),
  "redirect_uris" jsonb NOT NULL,
  "token_endpoint_auth_method" varchar(32) NOT NULL,
  "grant_types" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backoffice_mcp_oauth_authorization_codes" (
  "code_hash" varchar(64) PRIMARY KEY NOT NULL,
  "client_id" varchar(64) NOT NULL REFERENCES "backoffice_mcp_oauth_clients"("id") ON DELETE CASCADE,
  "actor_email" varchar(100) NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" varchar(128) NOT NULL,
  "scope" varchar(200) NOT NULL,
  "resource" text,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backoffice_mcp_oauth_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" varchar(64) NOT NULL REFERENCES "backoffice_mcp_oauth_clients"("id") ON DELETE CASCADE,
  "actor_email" varchar(100) NOT NULL,
  "access_token_hash" varchar(64) NOT NULL UNIQUE,
  "refresh_token_hash" varchar(64) NOT NULL UNIQUE,
  "scope" varchar(200) NOT NULL,
  "resource" text,
  "access_expires_at" timestamp with time zone NOT NULL,
  "refresh_expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backoffice_mcp_oauth_tokens_actor_idx"
  ON "backoffice_mcp_oauth_tokens" ("actor_email");

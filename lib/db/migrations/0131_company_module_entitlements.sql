-- Módulos por empresa (ADR 0041, oferta para Agências): o direito de acesso a
-- um Módulo (postagem, trafego) é por empresa e é a autoridade; a cobrança só
-- alimenta este estado. `company_module_events` é o histórico append-only e a
-- chave de idempotência por (empresa, Módulo): evento repetido não muda nada. `occurred_at` é o
-- instante do evento na origem; evento mais antigo que `last_event_at` do
-- direito fica no histórico com `applied = false`. Códigos de Módulo, status e
-- origem vivem no catálogo em TypeScript, sem CHECK no banco.
-- Shared FE 0140 / BO 0131, same `when` (1802000000000): first apply wins.

CREATE TABLE IF NOT EXISTS "company_module_entitlements" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "module" varchar(32) NOT NULL,
  "status" varchar(16) NOT NULL,
  "source" varchar(16) NOT NULL,
  "source_reference" varchar(255),
  "valid_until" timestamp with time zone,
  "last_event_at" timestamp with time zone NOT NULL,
  "updated_by_user_id" uuid REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("company_id", "module")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_module_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "module" varchar(32) NOT NULL,
  "event_type" varchar(16) NOT NULL,
  "source" varchar(16) NOT NULL,
  "source_reference" varchar(255),
  "valid_until" timestamp with time zone,
  "actor_user_id" uuid REFERENCES "users"("id"),
  "idempotency_key" varchar(255) NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "applied" boolean NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "company_module_events_idempotency_key_unique"
  ON "company_module_events" ("company_id", "module", "idempotency_key");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "company_module_events_company_module_idx"
  ON "company_module_events" ("company_id", "module", "occurred_at");

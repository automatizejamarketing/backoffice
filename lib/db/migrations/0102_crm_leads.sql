-- CRM interno do time comercial. O status comercial (novo lead, em
-- qualificação, reunião agendada...) é um funil controlado à mão e não tem
-- relação com o status da conta (acesso, trial, pagamento), que continua
-- derivado de `users.expiration_date` e de `payments`.
--
-- `crm_leads` guarda só o status atual por usuário; quem não tem linha é
-- "novo_lead". `crm_lead_events` é a linha do tempo: anotações livres do
-- contato e cada troca de status, com autor e data. Isso substitui a marca
-- "já entrei em contato" que vivia no localStorage de cada navegador.
--
-- Idempotente: pode rodar de novo sem efeito.

CREATE TABLE IF NOT EXISTS "crm_leads" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "commercial_status" varchar(32) NOT NULL DEFAULT 'novo_lead',
  "status_changed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "status_changed_by" varchar(100),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_leads_status_idx" ON "crm_leads" ("commercial_status", "status_changed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_lead_events" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "kind" varchar(16) NOT NULL,
  "body" text,
  "status_from" varchar(32),
  "status_to" varchar(32),
  "author_email" varchar(100) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crm_lead_events_user_idx" ON "crm_lead_events" ("user_id", "created_at");

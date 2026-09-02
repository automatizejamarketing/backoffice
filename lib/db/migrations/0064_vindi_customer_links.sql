-- ADR 0029 — um Cliente Vindi por par (Conta, CPF).
--
-- Espelhado byte-a-byte no backoffice como 0064_vindi_customer_links, com o
-- MESMO `when` (1794900000000): quem migrar primeiro aplica; o outro pula.
-- O `when` fica acima da marca d'água dos DOIS journals medida em 2026-09-01
-- (frontend 1794770000000, backoffice 1794810000000) — um `when` colidindo
-- entre os repos enterra a migração em silêncio, para sempre.
--
-- Estritamente aditivo: uma tabela nova e quatro colunas novas. Nada é
-- derrubado. `users.vindi_customer_id` e o índice
-- `users_vindi_customer_id_unique` continuam de pé, agora significando "o
-- Cliente Primário desta Conta" — o índice nunca foi o problema, era o
-- detector.

CREATE TABLE IF NOT EXISTS "vindi_customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "vindi_customer_id" varchar(255) NOT NULL,
  "registry_code" varchar(20),
  "vindi_code" varchar(255) NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Os três invariantes do ADR, expressos no banco.
-- 1. Um Cliente Vindi pertence a uma Conta só.
CREATE UNIQUE INDEX IF NOT EXISTS "vindi_customers_customer_unique"
  ON "vindi_customers" ("vindi_customer_id");--> statement-breakpoint

-- 2. Um CPF por Conta aponta para exatamente um Cliente.
CREATE UNIQUE INDEX IF NOT EXISTS "vindi_customers_user_registry_unique"
  ON "vindi_customers" ("user_id", "registry_code")
  WHERE "registry_code" IS NOT NULL;--> statement-breakpoint

-- 3. Uma Conta tem um Primário só.
CREATE UNIQUE INDEX IF NOT EXISTS "vindi_customers_primary_unique"
  ON "vindi_customers" ("user_id")
  WHERE "is_primary";--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vindi_customers_user_id_idx"
  ON "vindi_customers" ("user_id");--> statement-breakpoint

-- Backfill do Primário: toda Conta que já tem Cliente Vindi vira uma linha de
-- vínculo com `vindi_code = userId`, que é exatamente o `code` que o código
-- gravou na Vindi até aqui. Medido em 2026-09-01: 1 linha em produção.
INSERT INTO "vindi_customers"
  ("user_id", "vindi_customer_id", "registry_code", "vindi_code", "is_primary")
SELECT "id", "vindi_customer_id", "registry_code", "id"::text, true
FROM "users"
WHERE "vindi_customer_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Quem pagou cada venda, fotografado no ato, para relatório e backoffice não
-- dependerem da API da Vindi na leitura.
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "payer_registry_code" varchar(20);--> statement-breakpoint
ALTER TABLE "product_orders"
  ADD COLUMN IF NOT EXISTS "vindi_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "payer_registry_code" varchar(20);--> statement-breakpoint
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "vindi_customer_id" varchar(255);

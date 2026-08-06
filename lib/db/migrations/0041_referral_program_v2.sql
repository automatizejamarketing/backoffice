-- Programa de afiliados v2 — as onze tabelas do namespace `referral_*`
-- (ADR 0024, ADR 0026, spec 0024 Fase 1).
--
-- Puramente aditiva. As tabelas do v1 (`affiliates`, `affiliate_clicks`,
-- `affiliate_conversions`, `affiliate_action_logs`) e a coluna
-- `users.referred_by_affiliate_id` NÃO são tocadas: permanecem no banco,
-- intactas e sem uso. Nenhum dado é migrado e nenhum backfill interpreta o
-- conteúdo antigo — lendo o banco, o prefixo é o que diz qual conjunto está
-- vivo.
--
-- Três travas ficam aqui, no Postgres, e não na aplicação:
--   * um acordo vigente por afiliado;
--   * um pedido de saque aberto por afiliado;
--   * o mínimo de R$100 por pedido de saque.
-- Uma corrida de requisições não pode pagar em dobro, e essa garantia é do
-- banco.
--
-- Dinheiro é sempre centavos em `integer`.

CREATE TABLE IF NOT EXISTS "referral_program_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "version" integer NOT NULL,
  "attribution_window_days" integer NOT NULL,
  "waiting_period_days" integer NOT NULL,
  "min_payout_centavos" integer NOT NULL,
  "attribution_model" varchar DEFAULT 'last_click' NOT NULL,
  "effective_from" timestamp DEFAULT now() NOT NULL,
  "superseded_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_program_config_version_unique" UNIQUE("version")
);

-- Uma única configuração vigente. A expressão constante-por-linha-viva é o
-- idioma padrão de "no máximo uma linha satisfaz o predicado".
CREATE UNIQUE INDEX IF NOT EXISTS "referral_program_config_one_current"
  ON "referral_program_config" USING btree ((("superseded_at" IS NULL)))
  WHERE "superseded_at" IS NULL;

CREATE TABLE IF NOT EXISTS "referral_affiliates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "code" varchar(32) NOT NULL,
  "status" varchar DEFAULT 'pending' NOT NULL,
  "tax_document" varchar(20),
  "tax_document_type" varchar,
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "approved_by" varchar(120),
  "approved_at" timestamp,
  "rejected_by" varchar(120),
  "rejected_at" timestamp,
  "rejection_reason" text,
  "blocked_by" varchar(120),
  "blocked_at" timestamp,
  "block_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_affiliates_user_id_unique" UNIQUE("user_id"),
  CONSTRAINT "referral_affiliates_code_unique" UNIQUE("code"),
  CONSTRAINT "referral_affiliates_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
);

CREATE INDEX IF NOT EXISTS "referral_affiliates_status_idx"
  ON "referral_affiliates" USING btree ("status");

CREATE TABLE IF NOT EXISTS "referral_agreements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "affiliate_id" uuid NOT NULL,
  "format" varchar NOT NULL,
  "percentage_bps" integer,
  "fixed_amount_centavos" integer,
  "calculation_base" varchar DEFAULT 'net' NOT NULL,
  "duration" varchar DEFAULT 'lifetime' NOT NULL,
  "duration_cycles" integer,
  "effective_from" timestamp DEFAULT now() NOT NULL,
  "superseded_at" timestamp,
  "created_by" varchar(120),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_agreements_affiliate_id_fk"
    FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id"),
  CONSTRAINT "referral_agreements_format_value" CHECK (
    ("format" = 'percentage' AND "percentage_bps" IS NOT NULL AND "fixed_amount_centavos" IS NULL)
    OR
    ("format" = 'fixed' AND "fixed_amount_centavos" IS NOT NULL AND "percentage_bps" IS NULL)
  ),
  CONSTRAINT "referral_agreements_duration_cycles" CHECK (
    ("duration" = 'n_cycles' AND "duration_cycles" IS NOT NULL AND "duration_cycles" > 0)
    OR
    ("duration" <> 'n_cycles' AND "duration_cycles" IS NULL)
  )
);

-- Um acordo vigente por afiliado. Acordos superados nunca são apagados: são o
-- que explica as comissões passadas.
CREATE UNIQUE INDEX IF NOT EXISTS "referral_agreements_one_current"
  ON "referral_agreements" USING btree ("affiliate_id")
  WHERE "superseded_at" IS NULL;

CREATE INDEX IF NOT EXISTS "referral_agreements_affiliate_effective_idx"
  ON "referral_agreements" USING btree ("affiliate_id", "effective_from");

CREATE TABLE IF NOT EXISTS "referral_customers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "affiliate_id" uuid NOT NULL,
  "agreement_id" uuid NOT NULL,
  "signed_up_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_customers_user_id_unique" UNIQUE("user_id"),
  CONSTRAINT "referral_customers_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
  CONSTRAINT "referral_customers_affiliate_id_fk"
    FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id"),
  CONSTRAINT "referral_customers_agreement_id_fk"
    FOREIGN KEY ("agreement_id") REFERENCES "public"."referral_agreements"("id")
);

CREATE INDEX IF NOT EXISTS "referral_customers_affiliate_idx"
  ON "referral_customers" USING btree ("affiliate_id");

CREATE INDEX IF NOT EXISTS "referral_customers_agreement_idx"
  ON "referral_customers" USING btree ("agreement_id");

CREATE TABLE IF NOT EXISTS "referral_clicks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "affiliate_id" uuid NOT NULL,
  "visitor_id" uuid NOT NULL,
  "ip_hash" varchar(64),
  "user_agent" text,
  "referrer_url" text,
  "landing_url" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_clicks_affiliate_id_fk"
    FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id")
);

CREATE INDEX IF NOT EXISTS "referral_clicks_visitor_created_idx"
  ON "referral_clicks" USING btree ("visitor_id", "created_at");

CREATE INDEX IF NOT EXISTS "referral_clicks_affiliate_created_idx"
  ON "referral_clicks" USING btree ("affiliate_id", "created_at");

CREATE TABLE IF NOT EXISTS "referral_attributions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "customer_id" uuid,
  "affiliate_id" uuid NOT NULL,
  "click_id" uuid NOT NULL,
  "outcome" varchar NOT NULL,
  "reason" text,
  "config_version" integer NOT NULL,
  "resolved_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_attributions_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
  CONSTRAINT "referral_attributions_customer_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "public"."referral_customers"("id"),
  CONSTRAINT "referral_attributions_affiliate_id_fk"
    FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id"),
  CONSTRAINT "referral_attributions_click_id_fk"
    FOREIGN KEY ("click_id") REFERENCES "public"."referral_clicks"("id")
);

-- Um único toque vencedor por conta. Os perdedores são gravados sem limite,
-- cada um com o motivo da derrota.
CREATE UNIQUE INDEX IF NOT EXISTS "referral_attributions_one_winner"
  ON "referral_attributions" USING btree ("user_id")
  WHERE "outcome" = 'won';

CREATE INDEX IF NOT EXISTS "referral_attributions_user_idx"
  ON "referral_attributions" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "referral_attributions_affiliate_outcome_idx"
  ON "referral_attributions" USING btree ("affiliate_id", "outcome");

CREATE TABLE IF NOT EXISTS "referral_commissionable_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "event_key" varchar(255) NOT NULL,
  "kind" varchar NOT NULL,
  "status" varchar DEFAULT 'awaiting_settlement' NOT NULL,
  "gross_centavos" integer NOT NULL,
  "net_centavos" integer,
  "occurred_at" timestamp NOT NULL,
  "settled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_commissionable_events_event_key_unique" UNIQUE("event_key"),
  CONSTRAINT "referral_commissionable_events_payment_id_fk"
    FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id"),
  CONSTRAINT "referral_commissionable_events_customer_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "public"."referral_customers"("id"),
  CONSTRAINT "referral_commissionable_events_settled_needs_net" CHECK (
    "status" <> 'settled' OR "net_centavos" IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS "referral_commissionable_events_payment_idx"
  ON "referral_commissionable_events" USING btree ("payment_id");

CREATE INDEX IF NOT EXISTS "referral_commissionable_events_customer_idx"
  ON "referral_commissionable_events" USING btree ("customer_id");

CREATE INDEX IF NOT EXISTS "referral_commissionable_events_status_occurred_idx"
  ON "referral_commissionable_events" USING btree ("status", "occurred_at");

CREATE TABLE IF NOT EXISTS "referral_commissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "affiliate_id" uuid NOT NULL,
  "agreement_id" uuid NOT NULL,
  "agreement_snapshot" jsonb NOT NULL,
  "amount_centavos" integer NOT NULL,
  "status" varchar DEFAULT 'foreseen' NOT NULL,
  "releases_at" timestamp NOT NULL,
  "released_at" timestamp,
  "reversed_at" timestamp,
  "rejected_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_commissions_event_unique" UNIQUE("event_id"),
  CONSTRAINT "referral_commissions_event_id_fk"
    FOREIGN KEY ("event_id") REFERENCES "public"."referral_commissionable_events"("id"),
  CONSTRAINT "referral_commissions_affiliate_id_fk"
    FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id"),
  CONSTRAINT "referral_commissions_agreement_id_fk"
    FOREIGN KEY ("agreement_id") REFERENCES "public"."referral_agreements"("id"),
  CONSTRAINT "referral_commissions_amount_non_negative" CHECK (
    "amount_centavos" >= 0
  )
);

CREATE INDEX IF NOT EXISTS "referral_commissions_affiliate_status_idx"
  ON "referral_commissions" USING btree ("affiliate_id", "status");

CREATE INDEX IF NOT EXISTS "referral_commissions_status_releases_idx"
  ON "referral_commissions" USING btree ("status", "releases_at");

CREATE TABLE IF NOT EXISTS "referral_payout_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "affiliate_id" uuid NOT NULL,
  "amount_centavos" integer NOT NULL,
  "tax_document_snapshot" varchar(20) NOT NULL,
  "tax_document_type_snapshot" varchar NOT NULL,
  "status" varchar DEFAULT 'requested' NOT NULL,
  "admin_email" varchar(120),
  "proof_url" text,
  "denial_reason" text,
  "reviewed_at" timestamp,
  "paid_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_payout_requests_affiliate_id_fk"
    FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id"),
  CONSTRAINT "referral_payout_requests_minimum_amount" CHECK (
    "amount_centavos" >= 10000
  )
);

-- Um pedido aberto por afiliado. É esta linha que impede uma corrida de
-- requisições de pagar em dobro.
CREATE UNIQUE INDEX IF NOT EXISTS "referral_payout_requests_one_open"
  ON "referral_payout_requests" USING btree ("affiliate_id")
  WHERE "status" IN ('requested', 'approved');

CREATE INDEX IF NOT EXISTS "referral_payout_requests_affiliate_status_idx"
  ON "referral_payout_requests" USING btree ("affiliate_id", "status");

CREATE TABLE IF NOT EXISTS "referral_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "affiliate_id" uuid NOT NULL,
  "type" varchar NOT NULL,
  "amount_centavos" integer NOT NULL,
  "event_key" varchar(255) NOT NULL,
  "commission_id" uuid,
  "payout_request_id" uuid,
  "customer_id" uuid,
  "available_at" timestamp,
  "description" text,
  "created_by" varchar(120),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_ledger_entries_event_key_unique" UNIQUE("event_key"),
  CONSTRAINT "referral_ledger_entries_affiliate_id_fk"
    FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id"),
  CONSTRAINT "referral_ledger_entries_commission_id_fk"
    FOREIGN KEY ("commission_id") REFERENCES "public"."referral_commissions"("id"),
  CONSTRAINT "referral_ledger_entries_payout_request_id_fk"
    FOREIGN KEY ("payout_request_id") REFERENCES "public"."referral_payout_requests"("id"),
  CONSTRAINT "referral_ledger_entries_customer_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "public"."referral_customers"("id")
);

CREATE INDEX IF NOT EXISTS "referral_ledger_entries_affiliate_available_idx"
  ON "referral_ledger_entries" USING btree ("affiliate_id", "available_at");

CREATE INDEX IF NOT EXISTS "referral_ledger_entries_commission_idx"
  ON "referral_ledger_entries" USING btree ("commission_id");

CREATE INDEX IF NOT EXISTS "referral_ledger_entries_payout_idx"
  ON "referral_ledger_entries" USING btree ("payout_request_id");

CREATE TABLE IF NOT EXISTS "referral_admin_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "affiliate_id" uuid NOT NULL,
  "admin_email" varchar(120) NOT NULL,
  "action" varchar NOT NULL,
  "reason" text,
  "details" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_admin_actions_affiliate_id_fk"
    FOREIGN KEY ("affiliate_id") REFERENCES "public"."referral_affiliates"("id")
);

CREATE INDEX IF NOT EXISTS "referral_admin_actions_affiliate_created_idx"
  ON "referral_admin_actions" USING btree ("affiliate_id", "created_at");

-- A linha vigente da Configuração do Programa: janela de atribuição de 14
-- dias, carência de 30 dias, mínimo de saque de R$100 e modelo `last_click`.
-- Idempotente: só semeia num banco que ainda não tem configuração nenhuma.
INSERT INTO "referral_program_config" (
  "version",
  "attribution_window_days",
  "waiting_period_days",
  "min_payout_centavos",
  "attribution_model"
)
SELECT 1, 14, 30, 10000, 'last_click'
WHERE NOT EXISTS (SELECT 1 FROM "referral_program_config");

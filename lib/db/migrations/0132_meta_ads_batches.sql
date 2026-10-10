-- Lote de ações em Meta Ads do MCP do backoffice (pausar, ativar, orçamento diário):
-- a prévia guarda o plano com o estado lido da Meta e a aprovação no backoffice
-- executa este plano uma vez. Resultado por item em `items`; `run_id` + `lease_until`
-- identificam a única execução que pode gravar. Status no catálogo em TypeScript,
-- sem CHECK no banco.
-- Shared FE 0141 / BO 0132, same `when` (1802100000000): first apply wins.

CREATE TABLE IF NOT EXISTS "meta_ads_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid NOT NULL REFERENCES "backoffice_users"("id"),
  "note" text NOT NULL,
  "status" varchar(16) DEFAULT 'previewed' NOT NULL,
  "items" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "run_id" uuid,
  "lease_until" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_ads_batches_actor_created_idx" ON "meta_ads_batches" USING btree ("actor_id","created_at");

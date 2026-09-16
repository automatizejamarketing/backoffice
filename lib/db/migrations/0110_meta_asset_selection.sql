-- Ativos Meta: seleção fixa por usuário. Três tabelas novas, aditivas.
-- Política (uma linha por usuário), habilitados (um principal por tipo
-- garantido pelo índice parcial) e eventos append-only.
-- Idempotente: pode rodar de novo sem efeito. Não altera tabela existente.

CREATE TABLE IF NOT EXISTS "meta_asset_policies" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "ad_account_limit" integer NOT NULL DEFAULT 1,
  "identity_limit" integer NOT NULL DEFAULT 1,
  "selection_status" varchar(16) NOT NULL,
  "pending_reason" varchar(32),
  "pending_requested_by" varchar(100),
  "pending_requested_at" timestamp with time zone,
  "selected_at" timestamp with time zone,
  "selected_by" varchar(100),
  "selection_mode" varchar(16),
  "unavailable_asset_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "availability_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_enabled_assets" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "asset_kind" varchar(16) NOT NULL,
  "asset_id" text NOT NULL,
  "is_primary" boolean NOT NULL DEFAULT false,
  "display_name" text,
  "instagram_business_account_id" text,
  "instagram_username" text,
  CONSTRAINT "meta_enabled_assets_user_kind_id_unique" UNIQUE("user_id", "asset_kind", "asset_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meta_enabled_assets_one_primary_per_kind"
  ON "meta_enabled_assets" ("user_id", "asset_kind")
  WHERE "is_primary";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_enabled_assets_user_idx"
  ON "meta_enabled_assets" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_asset_events" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "event_type" varchar(32) NOT NULL,
  "actor" varchar(100) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_asset_events_user_idx"
  ON "meta_asset_events" ("user_id", "created_at");

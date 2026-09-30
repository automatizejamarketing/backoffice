-- Publicações seguradas ("em preparação"): o pedido de publicação que a Meta
-- recusou com 100/2859024 (certificação da política de não discriminação
-- pendente no Gerenciador de Negócios do cliente) fica guardado para ser
-- refeito no servidor com outra conexão. Ver `metaPublishHold` no schema.
-- Shared FE 0132 / BO 0125, same `when` (1801300000000): first apply wins.

CREATE TABLE IF NOT EXISTS "meta_publish_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "ad_account_id" text NOT NULL,
  "meta_account_id" text,
  "flow" varchar(16) NOT NULL,
  "request" jsonb NOT NULL,
  "draft_campaign_id" text,
  "draft_ad_set_id" text,
  "campaign_name" text,
  "reason_code" varchar(64) NOT NULL,
  "reason" jsonb,
  "status" varchar(16) DEFAULT 'held' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp,
  "last_error" text,
  "published_campaign_id" text,
  "published_via" varchar(16),
  "published_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "meta_publish_holds_user_status_idx"
  ON "meta_publish_holds" ("user_id", "status");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "meta_publish_holds_status_created_idx"
  ON "meta_publish_holds" ("status", "created_at");

-- Automação de Comentário→DM (ticket 07, Link Rastreado + Insights / CTR).
--
-- Gêmea de `backoffice/0063_comment_automation_tracked_links` e
-- `frontend/0066_comment_automation_tracked_links`, com o MESMO `when` (1794700000000).
-- A marca d'água de `drizzle.__drizzle_migrations` é compartilhada: quem
-- migrar primeiro aplica e o outro pula, o que só é seguro porque o DDL é
-- o mesmo. Os dois arquivos precisam ser IDÊNTICOS, comentários inclusive.
--
-- Aditivo. Acima da marca de frontend/0065 e backoffice/0062 (1794600000000).

CREATE TABLE IF NOT EXISTS "instagram_comment_automation_tracked_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid NOT NULL,
  "automation_id" uuid NOT NULL,
  "code" varchar(32) NOT NULL,
  "original_url" text NOT NULL,
  "label" text DEFAULT '' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "instagram_comment_automation_tracked_links_code_unique"
    UNIQUE("code"),
  CONSTRAINT "instagram_comment_automation_tracked_links_execution_url_unique"
    UNIQUE("execution_id", "original_url"),
  CONSTRAINT "instagram_comment_automation_tracked_links_execution_id_fk"
    FOREIGN KEY ("execution_id")
      REFERENCES "public"."instagram_comment_automation_executions"("id"),
  CONSTRAINT "instagram_comment_automation_tracked_links_automation_id_fk"
    FOREIGN KEY ("automation_id")
      REFERENCES "public"."instagram_comment_automations"("id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "instagram_comment_automation_tracked_links_automation_idx"
  ON "instagram_comment_automation_tracked_links" ("automation_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "instagram_comment_automation_link_clicks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tracked_link_id" uuid NOT NULL,
  "execution_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "instagram_comment_automation_link_clicks_link_id_fk"
    FOREIGN KEY ("tracked_link_id")
      REFERENCES "public"."instagram_comment_automation_tracked_links"("id"),
  CONSTRAINT "instagram_comment_automation_link_clicks_execution_id_fk"
    FOREIGN KEY ("execution_id")
      REFERENCES "public"."instagram_comment_automation_executions"("id")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "instagram_comment_automation_link_clicks_execution_idx"
  ON "instagram_comment_automation_link_clicks" ("execution_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "instagram_comment_automation_link_clicks_link_idx"
  ON "instagram_comment_automation_link_clicks" ("tracked_link_id");

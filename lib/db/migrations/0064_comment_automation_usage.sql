-- Automação de Comentário→DM (ticket 08, robustez operacional).
--
-- Gêmea de `backoffice/0064_comment_automation_usage` e
-- `frontend/0067_comment_automation_usage`, com o MESMO `when` (1794800000000).
-- A marca d'água de `drizzle.__drizzle_migrations` é compartilhada: quem
-- migrar primeiro aplica e o outro pula, o que só é seguro porque o DDL é
-- o mesmo. Os dois arquivos precisam ser IDÊNTICOS, comentários inclusive.
--
-- Aditivo. Acima da marca de frontend/0066 e backoffice/0063 (1794700000000).

CREATE TABLE IF NOT EXISTS "instagram_comment_automation_usage_months" (
  "instagram_account_id" text NOT NULL,
  "year_month" varchar(7) NOT NULL,
  "private_replies" integer DEFAULT 0 NOT NULL,
  "deliveries" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "instagram_comment_automation_usage_months_account_id_fk"
    FOREIGN KEY ("instagram_account_id")
      REFERENCES "public"."instagram_accounts"("id"),
  CONSTRAINT "instagram_comment_automation_usage_months_pk"
    PRIMARY KEY ("instagram_account_id", "year_month")
);

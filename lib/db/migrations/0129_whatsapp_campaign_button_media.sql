-- Botão e mídia de cabeçalho passam a ser dados da campanha (antes: fixos no código por nome de template).
-- Shared FE 0136 / BO 0129, same `when` (1801600000000): first apply wins.
ALTER TABLE "whatsapp_campaigns" ADD COLUMN IF NOT EXISTS "button" jsonb;--> statement-breakpoint
ALTER TABLE "whatsapp_campaigns" ADD COLUMN IF NOT EXISTS "header_media" jsonb;--> statement-breakpoint
-- Preserva o botão já aprovado das campanhas de outubro criadas antes desta migration.
UPDATE "whatsapp_campaigns" SET "button" = CASE
  WHEN "template_name" = 'outubro_2026_0510_atendimento_v2' THEN '{"text":"Falar com a equipe","url":"https://www.automatizemarketing.com/contato"}'::jsonb
  WHEN "template_name" = 'outubro_2026_0510_atendimento_v3' THEN '{"text":"Falar com a equipe","url":"https://www.automatizemarketing.com/contato-direto"}'::jsonb
  ELSE '{"text":"Falar com a equipe","url":"https://www.automatizemarketing.com/contato-direto/{{1}}"}'::jsonb
END
WHERE "button" IS NULL AND "template_name" IN ('outubro_2026_0510_atendimento_v2','outubro_2026_0510_atendimento_v3','outubro_2026_0510_atendimento_v4','outubro_2026_0810_assinatura_v2','outubro_2026_1210_trafego_v2','outubro_2026_2610_suporte_v2');

-- Métricas conhecidas promovidas a COLUNAS em `meta_tracking_daily_metrics`
-- (§4.2 do plano `backoffice/docs/plans/campaign-tracking-foundation.md`).
--
-- O contrato que estas colunas implantam: **análise lê coluna tipada, nunca
-- jsonb; o jsonb cru permanece intacto como reservatório de promoção**. As
-- famílias (`actions`, `action_values`, `cost_per_action_type`,
-- `cost_per_result`, `purchase_roas`, `website_purchase_roas`) NÃO são tocadas:
-- é delas que estas colunas saem — hoje na escrita, e retroativamente pelo
-- script `scripts/backfill-metric-columns.ts`, que reusa a mesma função de
-- extração.
--
-- Toda coluna é nullable de propósito: `NULL` significa "a Meta não reportou",
-- nunca zero. Um dia de campanha de mensagens não tem compra, e gravar `0` ali
-- apagaria a diferença entre "não se aplica" e "tentou e não vendeu". O
-- zero-verdadeiro se resolve na leitura, com objetivo e `spend` em mãos.
--
-- Conversões personalizadas (`offsite_conversion.custom.<id>`, nome dinâmico por
-- conta) são a exceção conhecida do contrato: não há coluna possível para elas,
-- e seguem legíveis só pelo jsonb cru.
--
-- `purchase_roas_value` e `cost_per_result_value` levam sufixo porque
-- `purchase_roas` e `cost_per_result` já existem como jsonb na MESMA tabela: o
-- sufixo é o que diz "o escalar promovido daquela família".
--
-- `video_actions` é o reservatório das sete famílias de vídeo que passam a ser
-- pedidas no field set. Todas têm a mesma forma
-- (`[{ action_type: "video_view", value }]`), então sete colunas jsonb não
-- comprariam nada — mas ficar só nas colunas escalares deixaria o vídeo fora do
-- reservatório, e é dele que sai qualquer promoção futura.
--
-- Estritamente aditiva: só `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, nenhuma
-- coluna existente alterada, nenhum DROP, nenhum default (coluna nova em tabela
-- grande com default seria reescrita de tabela).
--
-- O banco é compartilhado entre `backoffice` e `automatize-frontend`, e os dois
-- journals registram esta migration com o MESMO `when`: quem rodar primeiro
-- aplica, o outro pula (o migrador compara `created_at`). Por isso ela é
-- idempotente ponta a ponta (`IF NOT EXISTS` em tudo).

-- Reservatório das famílias de vídeo, cru como a Meta entrega.
ALTER TABLE "meta_tracking_daily_metrics"
  ADD COLUMN IF NOT EXISTS "video_actions" jsonb;
--> statement-breakpoint

-- Funil e comércio. `purchase_value` vem de `action_values`, em unidades
-- MAIORES da moeda da conta (como `spend`, ao contrário dos orçamentos das
-- versões de configuração, que vêm em unidades menores).
ALTER TABLE "meta_tracking_daily_metrics"
  ADD COLUMN IF NOT EXISTS "link_clicks" integer,
  ADD COLUMN IF NOT EXISTS "landing_page_views" integer,
  ADD COLUMN IF NOT EXISTS "content_views" integer,
  ADD COLUMN IF NOT EXISTS "adds_to_cart" integer,
  ADD COLUMN IF NOT EXISTS "checkouts_initiated" integer,
  ADD COLUMN IF NOT EXISTS "payment_infos_added" integer,
  ADD COLUMN IF NOT EXISTS "purchases" integer,
  ADD COLUMN IF NOT EXISTS "purchase_value" numeric,
  ADD COLUMN IF NOT EXISTS "purchase_roas_value" numeric;
--> statement-breakpoint

-- Leads. `complete_registration` tem coluna própria em vez de ser contado como
-- lead: misturar os dois faria "leads" mudar de significado conforme a conta.
ALTER TABLE "meta_tracking_daily_metrics"
  ADD COLUMN IF NOT EXISTS "leads" integer,
  ADD COLUMN IF NOT EXISTS "registrations_completed" integer;
--> statement-breakpoint

-- Mensagens (o objetivo mais comum das contas de WhatsApp).
ALTER TABLE "meta_tracking_daily_metrics"
  ADD COLUMN IF NOT EXISTS "messaging_conversations_started" integer,
  ADD COLUMN IF NOT EXISTS "messaging_first_replies" integer;
--> statement-breakpoint

-- Engajamento. `shares` vem do `action_type` "post" e `page_likes` do "like" —
-- o vocabulário da Meta, não o da interface.
ALTER TABLE "meta_tracking_daily_metrics"
  ADD COLUMN IF NOT EXISTS "post_engagements" integer,
  ADD COLUMN IF NOT EXISTS "page_engagements" integer,
  ADD COLUMN IF NOT EXISTS "post_reactions" integer,
  ADD COLUMN IF NOT EXISTS "comments" integer,
  ADD COLUMN IF NOT EXISTS "shares" integer,
  ADD COLUMN IF NOT EXISTS "post_saves" integer,
  ADD COLUMN IF NOT EXISTS "page_likes" integer;
--> statement-breakpoint

-- Vídeo. Nasce para frente: os campos que as alimentam entram no field set
-- agora, então dia já coletado fica NULL e não é backfillável.
ALTER TABLE "meta_tracking_daily_metrics"
  ADD COLUMN IF NOT EXISTS "video_views_3s" integer,
  ADD COLUMN IF NOT EXISTS "thruplays" integer,
  ADD COLUMN IF NOT EXISTS "video_watches_p25" integer,
  ADD COLUMN IF NOT EXISTS "video_watches_p50" integer,
  ADD COLUMN IF NOT EXISTS "video_watches_p75" integer,
  ADD COLUMN IF NOT EXISTS "video_watches_p95" integer,
  ADD COLUMN IF NOT EXISTS "video_watches_p100" integer,
  ADD COLUMN IF NOT EXISTS "video_avg_watch_seconds" numeric;
--> statement-breakpoint

-- Outros. `results` é o resultado na definição da PRÓPRIA conta, derivado do
-- `indicator` de `cost_per_result` (que nomeia o action_type do resultado);
--> statement-breakpoint
-- `estimated_ad_recallers` também nasce para frente.
ALTER TABLE "meta_tracking_daily_metrics"
  ADD COLUMN IF NOT EXISTS "estimated_ad_recallers" integer,
  ADD COLUMN IF NOT EXISTS "app_installs" integer,
  ADD COLUMN IF NOT EXISTS "results" integer,
  ADD COLUMN IF NOT EXISTS "cost_per_result_value" numeric;

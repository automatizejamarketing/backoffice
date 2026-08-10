# 12 — Métricas promovidas a colunas (modelo de leitura tipado)

**What to build:** O contrato de leitura aprovado: **análise lê colunas, nunca jsonb; o jsonb das famílias cruas permanece intacto como reservatório de promoção**. A tabela `meta_tracking_daily_metrics` ganha ~31 colunas nullable de métricas conhecidas (válidas para os três níveis), a extração acontece num único ponto na escrita, os helpers de correlação migram para ler colunas, e o field set passa a pedir também os campos de vídeo e ad recall que hoje não são coletados. Métrica que a Meta não reportar fica NULL (semântica: "não reportado" — o zero-verdadeiro se resolve na leitura com objetivo + spend). Conversões personalizadas (nome dinâmico por conta) seguem só no cru — a exceção conhecida do contrato.

**Blocked by:** None — can start immediately (constrói sobre 01/04/08 concluídos).

**Status:** resolved

- [x] **Migration aditiva em par** (backoffice `0045` / frontend `0053`, byte-idênticas, mesmo `when` nos dois journals — o padrão da casa desde 0044/0052), escrita à mão (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`), criando as colunas nullable abaixo. **NÃO aplicada em banco nenhum** (runbook para o humano).
- [x] **As colunas** (todas nullable; nomes em snake_case): funil/comércio `link_clicks, landing_page_views, content_views, adds_to_cart, checkouts_initiated, payment_infos_added, purchases, purchase_value, purchase_roas` · leads `leads, registrations_completed` · mensagens `messaging_conversations_started, messaging_first_replies` · engajamento `post_engagements, page_engagements, post_reactions, comments, shares, post_saves, page_likes` · vídeo `video_views_3s, thruplays, video_watches_p25, video_watches_p50, video_watches_p75, video_watches_p95, video_watches_p100, video_avg_watch_seconds` · outros `estimated_ad_recallers, app_installs, results, cost_per_result`. Contagens como integer, valores monetários/razões como numeric. *(reinterpretado: **duas** colunas mudaram de nome — `purchase_roas_value` e `cost_per_result_value` —, porque `purchase_roas` e `cost_per_result` já existem como jsonb na MESMA tabela. Ver Comments.)*
- [x] **Extração num único ponto** (`toDailyMetricRows`): valores reportados viram colunas; ausentes ficam NULL; as listas de prioridade (`omni_purchase` > `purchase`, sem dupla contagem) vivem SÓ ali. `results` derivado do `indicator` do `cost_per_result` (que nomeia o action_type do resultado) com fallback `spend ÷ cost_per_result`; NULL quando inderivável. *(a extração é um módulo próprio, `lib/meta-tracking/metric-columns.ts`, chamado por `toDailyMetricRows` — o ponto de escrita continua sendo um só, e o backfill reusa a MESMA função.)*
- [x] **Field set de insights** ganha os campos de topo de vídeo (`video_thruplay_watched_actions`, `video_p25/50/75/95/100_watched_actions`, `video_avg_time_watched_actions`, `video_play_actions` se aplicável) e `estimated_ad_recallers`, com recuo (core set) preservado — os novos saem primeiro no recuo, como os demais campos jovens do catálogo.
- [x] **Famílias cruas intactas** (`actions`, `action_values`, `cost_per_action_type`, `cost_per_result`, `purchase_roas`…) — nenhuma remoção; decidir e documentar onde o cru dos campos de vídeo novos vive (jsonb agregado ou só colunas, com justificativa pelo princípio do reservatório). *(escolhido o **jsonb agregado**: coluna nova `video_actions`. Justificativa nos Comments.)*
- [x] **Helpers de correlação migrados**: `computeActionEffect`/agregações passam a ler as colunas novas; nenhuma lógica de prioridade duplicada fora da extração; testes dos helpers atualizados.
- [x] **Script de backfill retroativo** das colunas a partir do jsonb já gravado (`UPDATE` em lotes, idempotente, retomável) escrito e coberto por teste puro da transformação — **NÃO executado** (vídeo/ad recall nascem para frente; documentar isso no script).
- [x] **Contrato de leitura documentado**: seção no plano (`docs/plans/campaign-tracking-foundation.md`) + comentário na tabela no schema: análise lê colunas; jsonb é reservatório de promoção; campo novo interessante da Meta entra no field set imediatamente mesmo sem coluna; conversões personalizadas são a exceção conhecida.
- [x] Espelho do bloco nos dois `schema.ts` com teste de paridade passando; testes puros com fixtures de múltiplos objetivos (vendas, WhatsApp, engajamento, vídeo, alcance) provando as colunas certas preenchidas e as demais NULL; zero falhas novas vs baseline.

## Comments

### O que foi entregue

**A costura pura (o coração do ticket):**

- **`lib/meta-tracking/metric-columns.ts`** — o ÚNICO lugar que sabe qual
  `action_type` da Meta responde por qual métrica. `extractMetricColumns`
  (famílias ⇒ 32 colunas), `metricColumnSourceFromInsightsRow` (a linha crua
  traduzida para o vocabulário da tabela, incluindo o recolhimento das famílias
  de vídeo) e `planMetricColumnPromotion` (o lote do backfill retroativo).
  **31 testes** com fixtures de cinco objetivos.

**A ligação na escrita:**

- `toDailyMetricRows` extrai as colunas uma vez por linha; `DailyMetricRow` é
  agora `{ … } & MetricColumns`.
- `upsertDailyMetricRows` grava tudo. O INSERT virou `{ ...row }` e o UPDATE do
  conflito passou a ser derivado de `getTableColumns` — a próxima métrica
  promovida entra nos dois de graça, em vez de exigir que alguém lembre de
  acrescentá-la em dois lugares (esquecer no UPDATE gravaria valor velho para
  sempre, e em silêncio).
- `INSIGHTS_METRIC_FIELDS` ganhou as 8 famílias de vídeo + `estimated_ad_recallers`,
  agrupados num `INSIGHTS_YOUNG_METRIC_FIELDS` que é exatamente o que o recuo
  (core set) remove — `cost_per_result` incluído, como antes.

**A migração da leitura:**

- `correlation.ts` perdeu `PURCHASE_ACTION_TYPES`, `ROAS_ACTION_TYPES` e
  `actionFamilyValue`. `DailyMetricPoint` lê `purchases`/`purchaseValue` das
  colunas; o jsonb continua na linha e é ignorado.

**A promoção retroativa:**

- `scripts/backfill-metric-columns.ts` + `listMetricRowsForPromotion` /
  `applyPromotedMetricColumns`. Simula por padrão; `--apply` escreve.

**Migration em par:** `0045_meta_tracking_metric_columns.sql` (backoffice) e
`0053_…` (frontend), **byte-idênticas** (`diff` limpo), mesmo `when`
(`1793300000000`) nos dois journals, só `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
Bloco `meta_tracking_*` espelhado nos dois `schema.ts` (teste de paridade 3/3).

### As quatro decisões que valem revisão

1. **`purchase_roas_value` e `cost_per_result_value` — os nomes que o ticket não
   podia ter.** `purchase_roas` e `cost_per_result` **já existem** na tabela como
   jsonb (ticket 01), e o ticket pedia colunas escalares com o mesmo nome: é
   colisão, não escolha. Renomear o jsonb seria destrutivo, então o escalar
   promovido leva sufixo `_value`, e a regra vale para qualquer promoção futura
   que colida com sua própria família. As outras 30 colunas têm exatamente os
   nomes pedidos.
2. **O cru do vídeo vive num jsonb agregado (`video_actions`), não em sete
   colunas jsonb nem só nas colunas escalares.** As sete famílias têm a mesma
   forma (`[{ action_type: "video_view", value }]`), então sete colunas não
   comprariam nada; e ficar só no escalar deixaria justamente os campos NOVOS
   fora do reservatório — quebrando o princípio no primeiro caso em que ele
   importa. Com o reservatório, `video_play_actions` (pedido no field set e sem
   coluna) é capturado hoje e promovível amanhã, e a promoção retroativa
   re-deriva TODAS as colunas de uma linha a partir da própria linha.
3. **O fallback de ROAS do ticket 08 mudou de casa: agora vive na EXTRAÇÃO.**
   Quando a conta não reporta `action_values` mas reporta ROAS, `purchase_value`
   é reconstruído como `roas × spend` **na escrita**. Reconstruir na leitura
   significaria cada consumidor reconstruindo à sua maneira — e a coluna existe
   justamente para que a resposta seja uma só. `correlation.ts` não sabe mais o
   que é ROAS.
4. **`leads` NÃO inclui `complete_registration`, ao contrário de
   `transformers.ts`.** Lá ele era substituto de lead porque não havia outra
   coluna para recebê-lo; aqui `registrations_completed` existe, e misturar os
   dois faria "leads" mudar de significado conforme a conta.

### Avisos para os próximos tickets

1. **A migration `0045`/`0053` NÃO foi aplicada em banco nenhum** — mesma razão
   dos tickets anteriores (`.env.local` do backoffice aponta para PRODUÇÃO). Até
   alguém aplicá-la, **a coleta diária quebra**: o upsert escreve colunas que não
   existem. Ou seja, `0044` e `0045` têm de ser aplicadas juntas, nesta ordem,
   antes da primeira execução real do coletor. Runbook abaixo.
2. **`results` é uma DERIVAÇÃO, não um campo da Meta.** A consulta de insights
   comum não devolve `results`; o que existe é `cost_per_result`, e o `indicator`
   dele nomeia o `action_type` do resultado. Regra: contar esse tipo em `actions`
   (exato); senão `spend ÷ cost_per_result` (mesmo número, com o arredondamento
   que a precisão do custo permitir); senão NULL. Quem for comparar `results`
   com o Gerenciador precisa saber disso.
3. **Vídeo e `estimated_ad_recallers` nascem para frente.** Os campos entraram no
   field set agora; dia coletado antes fica NULL para sempre. Não é buraco, é a
   data em que a captura começou — e é por isso que o script de promoção
   retroativa não os "conserta".
4. **Contagem é ARREDONDADA aqui, truncada em `daily-metrics.ts`.** São
   perguntas diferentes: impressões e cliques a Meta manda inteiros; ação
   atribuída pode vir fracionária (`"6.9998"`) quando o evento é dividido entre
   janelas de atribuição, e truncar subestimaria em silêncio. Os dois arquivos
   têm o aviso.
5. **Índices/colunas desejados, nenhuma migration extra criada.** As colunas
   promovidas nasceram sem índice: elas servem a filtro e agregação por conta ×
   período, e os índices `(account_id, metric_date)` / `(campaign_id,
   metric_date)` já cobrem o recorte. Se surgir consulta do tipo "campanhas com
   `purchases > 0` no mês", é índice parcial aditivo. Continuam pendentes os já
   anotados: GIN em `changed_fields`, UNIQUE parcial da versão vigente, parcial
   por `source` interno, `meta_tracking_account_coverage.metric_rows_upserted` e
   o parcial `(account_id, creative_id)` do ticket 11.
6. **Nenhum contador novo** entrou no summary do run, na rota de cron, no script
   do coletor ou em `COUNTER_KEYS` — a promoção acontece dentro da linha que já
   era contada por `metricRowsUpserted`.
7. **Duplicação consciente:** as listas de prioridade de `metric-columns.ts`
   parecem as de `lib/meta-business/transformers.ts` (que **não** é arquivo
   espelhado e poderia exportá-las). Ficaram separadas porque respondem a
   perguntas diferentes — um card de UI *hoje* × uma coluna de histórico
   *permanente* — e porque uma delas diverge de propósito (decisão 4). O mesmo
   vale para os coercitivos `text`/`decimal`, que já eram duplicados de propósito
   entre `daily-metrics.ts` e `config-version.ts`.

### Runbook para o humano (o que exige banco real)

Nada abaixo foi executado: nenhum comando tocou Postgres nem a Graph API.

1. **Aplicar as migrations, na ordem.** `0044` (fundação) e `0045` (colunas) ainda
   estão pendentes. Decida o alvo (`APP_ENV`) e rode `bun run db:migrate` **no
   backoffice** — nunca `db:push`, nunca `drizzle-kit migrate` direto. O frontend
   pula sozinho (mesmo `when` nos dois journals). Antes disso, vale arrumar a
   inversão dos `.env` descrita no ticket 01.
2. **Conferir as colunas:** `\d meta_tracking_daily_metrics` deve mostrar as 32
   colunas promovidas + `video_actions`, todas nullable e sem default.
3. **Primeira coleta depois da migration:**
   `APP_ENV=<alvo> bun scripts/with-env.ts bun scripts/collect-meta-tracking.ts --user=<uuid> --max=1`
   e então
   `SELECT metric_date, spend, purchases, purchase_value, results, cost_per_result_value, thruplays FROM meta_tracking_daily_metrics ORDER BY metric_date DESC LIMIT 5;`
   — em conta de vendas, `purchases`/`purchase_value` preenchidos; em conta de
   WhatsApp, `messaging_conversations_started`; em conta de alcance, quase tudo
   NULL e `results` derivado. Comparar `purchases` e `results` de um dia com o
   Gerenciador de Anúncios: têm de bater (aviso 2 explica quando o `results`
   arredonda).
4. **Se `thruplays` e `estimated_ad_recallers` vierem NULL em conta que tem
   vídeo**, o recuo por erro 100 disparou: o field set jovem foi recusado. Olhe
   o warning `field set de insights rejeitado em <nível>` no log do run — é o
   primeiro lugar a checar, e o mais provável entre os campos novos.
5. **UPDATE de backfill retroativo** (só faz sentido se já houver série gravada
   ANTES da `0045`; se a tabela estiver vazia, pule):
   ```
   APP_ENV=<alvo> bun scripts/with-env.ts bun scripts/backfill-metric-columns.ts            # simula
   APP_ENV=<alvo> bun scripts/with-env.ts bun scripts/backfill-metric-columns.ts --apply    # escreve
   ```
   Retomável: cada lote imprime `--after=<uuid>`. Idempotente: rodar de novo
   escreve os mesmos valores. Não toca `last_refreshed_at` nem respeita
   `is_final` (promover não muda valor — copia para coluna o que o jsonb da
   própria linha já dizia).

### Verificação (ambiente)

- `bun test lib/meta-tracking/` → **372/372** (32 novos: 31 de `metric-columns`
  + 1 de `daily-metrics`; `correlation` manteve 31 com dois testes reescritos
  para o contrato de colunas).
- `bunx tsc --noEmit` (backoffice) → o **mesmo baseline pré-existente** de 11
  linhas (`portfolio-filters.test.ts`, `users-csv.test.ts`,
  `frontend-app-url.test.ts`); zero erro nos arquivos deste ticket.
- `bunx tsc --noEmit` (frontend) → as **mesmas 18 linhas** pré-existentes; zero
  em `lib/db/schema.ts`.
- `bunx eslint` nos arquivos tocados → limpo (só o warning pré-existente
  `AppUsage` em `schema.ts`).
- `bun test` completo no **backoffice** → 589 pass / 67 fail; **todas** as falhas
  nas suítes de integração do Programa de Afiliados (`ECONNREFUSED` em
  `localhost:5432`, Postgres descartável via Docker ausente) e na cascata de
  `describe() inside another test()` que elas provocam. Prova: `lib/referral/
  write-off.test.ts` passa sozinho (21/21). **Zero falhas em `meta-tracking`.**
- `bun test` completo no **frontend** → 1058 pass / **44 fail** — exatamente o
  baseline documentado no ticket 01.
- **NADA foi executado contra Postgres nem contra a Graph API.** A migration não
  foi aplicada, o script de promoção não foi rodado, e todos os testes são puros.
- Fontes espelhadas intocadas: nada em `lib/meta-business/` foi editado (as
  listas de `transformers.ts` foram apenas LIDAS).

### Code review

Rodado ao final nos dois eixos (padrões do repo + spec do ticket). Sem
ferramenta de sub-agente disponível nesta sessão, os dois eixos foram
percorridos manualmente sobre o diff — mesma nota dos tickets 04/08/11. Três
achados reais, corrigidos antes do commit:

1. **`action_type` inventado** — `omni_add_payment_info`, `omni_video_view`,
   `messaging_conversation_started_7d` e `messaging_first_reply` (formas sem o
   prefixo `onsite_conversion.`) entraram nas listas "por precaução" e **não
   existem** no catálogo da Meta. Removidos: se algum dia aparecerem, aparecem
   primeiro no reservatório cru, que é para isso que ele existe.
2. **Ramo morto no script** — `cursor = nextCursor ?? cursor` depois de um
   `if (rows.length === 0) break`. Trocado pelo contrato já testado do lote
   vazio (`nextCursor === null` encerra a varredura).
3. **Comentário desatualizado** — `UPSERT_BATCH_SIZE` dizia "~18 parâmetros por
   linha"; com as colunas promovidas são ~54 (400 × 54 ainda bem abaixo do teto
   de 65.535 do Postgres). Corrigido, porque é ele que justifica o número.

Mantidos conscientemente: a duplicação das listas com `transformers.ts` e dos
coercitivos com `daily-metrics.ts` (aviso 7); e o `set` do UPDATE derivado de
`getTableColumns` com um cast para `PgUpdateSetSource` — o cast é o preço de não
ter 50 linhas que alguém vai esquecer de atualizar.

### Incidente pós-verificação: o drizzle-kit no-opou a 0045 em silêncio (resolvido)

Na aplicação em staging (2026-08-10), `APP_ENV=staging bun run db:migrate` REGISTROU a
0045 em `drizzle.__drizzle_migrations` mas NÃO executou os ALTERs — 22 colunas depois
do "migrations applied successfully". O SQL era válido (aplicado manualmente via
`postgres.unsafe` numa transação, as 33 colunas nasceram na hora — staging agora tem
as 55). Causa provável: chunk multi-statement sem `--> statement-breakpoint`
atravessando o pooler em modo transação; a 0044 (CREATEs) passou pelo mesmo caminho e
executou, então o gatilho exato não foi isolado — o conserto elimina a classe inteira.

**Conserto**: os pares 0045/0053 E 0044/0052 ganharam os marcadores canônicos
`--> statement-breakpoint` entre statements (formato de 24 migrations da casa; cada
statement vira um chunk próprio, imune a qualquer modo de protocolo), mantendo a
identidade byte a byte de cada par. Validação: 30 chunks na 0044, 8 na 0045, todos
não-vazios.

**Estado dos bancos**: staging tem 0044 + 0045 aplicadas E registradas (a 0045 com
conteúdo aplicado manualmente; o registro já existente impede re-execução, e o
IF NOT EXISTS torna qualquer re-execução inofensiva). PRODUÇÃO não tem nenhuma das
duas — quando o deploy rodar o migrate, os arquivos agora fatiados aplicam correto.
Lição para as próximas migrations manuais: SEMPRE incluir os marcadores; e depois de
todo apply, conferir o efeito com uma consulta ao information_schema — "applied
successfully" do drizzle-kit não é prova de execução.

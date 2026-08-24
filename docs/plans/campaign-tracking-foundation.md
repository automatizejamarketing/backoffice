# Plano — Fundação de Tracking de Campanhas Meta (v1)

> Branch: `feat/campaign-tracking-foundation` (a partir de `staging`, nos dois repos).
> Status: plano aprovado em entrevista (2026-08-09). Próximo passo: especificação via `to-spec`.
> Repo dono da migration e do coletor: **backoffice**. O schema é espelhado em `automatize-frontend/lib/db/schema.ts` (regra dos CLAUDE.md).

## 1. Objetivo

Construir a base de dados sólida que registra, para todas as contas Meta conectadas:

1. **Configuração** de cada campanha / conjunto de anúncio / anúncio ao longo do tempo (estado em qualquer data);
2. **Resultados diários** por entidade (granularidade mínima de 1 dia, sempre);
3. **Ações tomadas** (toda mudança de configuração em qualquer nível), com autor e **motivo** quando originadas do backoffice, e detecção via API quando feitas direto no Gerenciador de Anúncios;
4. Insumos para **correlação ação→resultado** computada na leitura.

A base é multi-propósito por design (informacional, tomada de decisão, criação enviesada, otimizador futuro): o registro integral fica em JSONB, as consultas do dia-a-dia usam colunas tipadas, e o diff entre configurações é pré-computado na coleta.

## 2. Decisões travadas (entrevista 2026-08-09)

| # | Decisão |
|---|---|
| 1 | **Escopo**: todos os usuários com `meta_business_accounts` ativo, todas as ad accounts atribuídas; campanhas `[AM]` e não-`[AM]`, com flag `isManaged` derivada do prefixo configurável em `business_operating_rules.managed_campaign_name_prefix`. |
| 2 | **Estados**: tracking profundo diário (config + diff + versões) **apenas para `effective_status = ACTIVE`**. A listagem diária por conta vê todas as entidades para gerar eventos de transição (pausou / arquivou / deletou / despausou) e reincluir quem voltar a ativo. Campanha que não gasta não é trackeada em profundidade. |
| 3 | **Armazenamento**: versões de configuração (SCD tipo 2 — linha nova só quando muda, `valid_from`/`valid_to`) + série diária de métricas (entidade×dia) + stream unificado de ações com `changed_fields {old,new}` pré-computado. Híbrido: colunas tipadas para consulta + `config` JSONB integral. **Não** reusar `performance_snapshots` (modelo de janela rolante, fundação frágil). |
| 4 | **Fontes de ação**: diff do coletor = fonte de verdade; poll diário de `/act_{id}/activities` persistido cru e usado como **enriquecimento** (autor, horário exato) por match; escritas diretas do backoffice (motivo **obrigatório**) e do frontend (source `user`, motivo n/a). Dual-write nas tabelas legadas de edit log. |
| 5 | **Métricas**: 3 níveis (campaign/adset/ad), upsert diário da janela móvel de **28 dias** com `time_increment=1`; persistência **sempre por dia** — janelas de análise são consulta, nunca armazenamento. Campos = conjunto já usado pelo backoffice. `use_unified_attribution_setting=true`. Sem breakdowns na v1. |
| 6 | **Backfill**: 13 meses, 3 níveis, na ativação (janela de 37 meses da Meta desliza; capturar agora). Config histórica não existe na API — estado atual vira a versão inicial. |
| 7 | **Execução**: cron Vercel no backoffice (00:00–07:45 BRT, fora da janela 08:00–09:15 BRT dos crons existentes), múltiplos disparos drenando lotes por invocação (`maxDuration=800 s`, deadline interno total de 600 s com reserva de finalização), `onlyStale` por dia, recuperação de runs travados, `CRON_SECRET`. Sem fila nova. |
| 8 | **Correlação**: computada na leitura via helpers (janelas antes/depois, flag de ações concorrentes). Nada materializado na v1. |
| 9 | **Cross-cliente**: consumo apenas via padrões agregados/anonimizados (precedente `client_fingerprint`). Na v1 a regra é documentada; a camada concreta nasce com o primeiro consumidor. |
| 10 | **Escopo v1**: fundação + visibilidade mínima de operação no backoffice (status/cobertura/erros dos runs + histórico unificado de ações com motivo). Sem dashboards analíticos. |

Defaults assumidos: dias na timezone da ad account (como a Meta reporta); valores monetários em unidades menores na moeda da conta; ao desconectar a Meta a coleta para e o histórico permanece; infra de tokens existente (BISU / refresh cron / `needs_reconnect`) intocada.

## 3. Fatos da Marketing API v25.0 que moldam o design

Verificados na documentação oficial (dossiê da entrevista):

- **Mudanças retroativas**: insights mudam por até **28 dias** e depois congelam → upsert de janela móvel de 28 dias.
- **Lookback máximo**: 37 meses (deslizante) → backfill de 13 meses capturado na ativação.
- **`updated_time` de campanha não é confiável**: mudanças de budget/spend_cap **não** atualizam o campo (documentado) e `/campaigns` não tem `updated_since` → diff de snapshot é obrigatório no nível campanha. `updated_since` existe em `/adsets` e `/ads` e serve de pré-filtro barato.
- **`/act_{id}/activities`**: único audit trail oficial (`event_type`, `actor_name`, `event_time`, todos os níveis). `extra_data` (old/new) é **não documentado** e a retenção também não (default de consulta = 7 dias) → tratar como enriquecimento oportunista, nunca fonte primária.
- **Rate limit BUC é por ad account** (dev tier: `ads_insights` 600+400×ads ativos/hora; `ads_management` 300+40×ads) → paralelizar entre contas não compete pela mesma cota; monitorar `X-Business-Use-Case-Usage` e `X-FB-Ads-Insights-Throttle`.
- **Limite de linhas de insights**: erro 100 / subcode 1487534 → fallback: reduzir range/chunk e, em último caso, job async (`report_run_id`, expira em 30 dias).
- **Advantage+**: identificar por `advantage_state` / `advantage_state_info` + `smart_promotion_type`. Campanhas ASC/AAC legadas serão **pausadas pela Meta na v26 (~set/2026)** → capturar esses campos desde já; esperar onda de transições de status.
- **Batch API**: 50 sub-requests por batch; cada sub-request conta individualmente na cota.
- Sem webhooks para mudanças de objetos de anúncio — polling é o único mecanismo.

## 4. Modelo de dados (novas tabelas, espelhadas nos dois `schema.ts`)

Prefixo de domínio: `meta_tracking_*`. Migration additiva, gerada no backoffice (`bun run db:generate` + `bun run db:migrate` com baseline custom — nunca `db:push`).

### 4.1 `meta_tracking_config_versions` — versões de configuração (SCD2)

Uma linha por entidade × configuração distinta. Nasce no primeiro avistamento e a cada mudança detectada.

- Identidade: `id` uuid, `user_id`, `account_id`, `entity_level` (`campaign|adset|ad`), `entity_id` (id Meta), `campaign_id`, `adset_id` (desnormalizados p/ filtro), `entity_name`.
- Vigência: `valid_from` (primeira observação da config), `valid_to` (NULL = vigente), `version_number` (sequencial por entidade), `first_seen_run_id`, `last_confirmed_at` (última vez observada idêntica).
- Diff: `config_hash` (sha256 da config normalizada), `config` jsonb integral (resposta da API), `is_managed` boolean (prefixo `[AM]` avaliado na coleta).
- Colunas tipadas (consulta quente — subconjunto por nível, NULL quando não se aplica):
  - Comuns: `configured_status`, `effective_status`*, `created_time_meta`, `updated_time_meta`*.
  - Campaign: `objective`, `buying_type`, `bid_strategy`, `daily_budget`, `lifetime_budget`, `spend_cap`, `special_ad_categories` jsonb, `smart_promotion_type`, `advantage_state`, `is_adset_budget_sharing_enabled`, `budget_mode` (`CBO|ABO`, derivado).
  - Adset: `optimization_goal`, `billing_event`, `bid_amount`, `destination_type`, `daily_budget`/`lifetime_budget`, `start_time`/`end_time`, `is_dynamic_creative`, `targeting` jsonb, `promoted_object` jsonb, `attribution_spec` jsonb, `frequency_control_specs` jsonb, `pacing_type` jsonb, `dsa_beneficiary`, `dsa_payor`.
  - Ad: `creative_id`, `conversion_domain`, `tracking_specs` jsonb.
- **Campos voláteis ficam FORA do hash** (guardados na versão, mas não disparam versão nova): `effective_status` (muda por cascata de pausa do pai — vira evento de transição, não versão), `budget_remaining`, `learning_stage_info` jsonb, `issues_info` jsonb, `updated_time`, `last_budget_toggling_time`, métricas embutidas.
- Índices: unique `(entity_level, entity_id, config_hash, valid_from)`; parcial `(entity_level, entity_id) WHERE valid_to IS NULL` (versão vigente); `(account_id, valid_from)`; `(user_id)`.

### 4.2 `meta_tracking_daily_metrics` — série diária de resultados

Uma linha por entidade × dia (dia na timezone da ad account, como a Meta reporta).

- `id`, `user_id`, `account_id`, `entity_level`, `entity_id`, `campaign_id`, `adset_id`, `metric_date` date.
- Tipadas: `spend` numeric, `impressions`, `clicks`, `reach`, `frequency` numeric.
- JSONB: `actions`, `action_values`, `cost_per_action_type`, `cost_per_result`, `purchase_roas`, `website_purchase_roas` (famílias com cardinalidade variável).
- Controle de mutabilidade: `first_captured_at`, `last_refreshed_at`, `is_final` boolean (true quando `metric_date` < hoje−28d na última re-coleta).
- Moeda/tz: `currency` e `timezone_name` ficam em `meta_tracking_account_coverage`/registro da conta, não por linha.
- Unique `(entity_level, entity_id, metric_date)`; índices `(account_id, metric_date)`, `(campaign_id, metric_date)`, `(user_id, metric_date)`.
- Upsert: `INSERT ... ON CONFLICT DO UPDATE` da janela móvel; nunca deletar.

#### 4.2.1 Contrato de leitura: análise lê COLUNAS, o jsonb é RESERVATÓRIO

Decisão travada (migration `0045`/`0053`): as métricas conhecidas estão promovidas a ~32 colunas nullable, válidas para os três níveis, e **quem analisa lê coluna tipada — nunca abre `actions`/`action_values` em consulta**. As famílias cruas continuam gravadas inteiras porque são o **reservatório de promoção**: é delas que sai a coluna de uma métrica que hoje ninguém consulta, já preenchida sobre o histórico de ontem.

As regras que valem para sempre:

1. **A extração acontece num ponto só** — `lib/meta-tracking/metric-columns.ts`, chamado por `toDailyMetricRows` na escrita. As listas de prioridade que impedem a dupla contagem (`omni_purchase` e `purchase` são o mesmo fato) vivem lá e em lugar nenhum mais; os helpers de correlação (§8) leem as colunas e não reinterpretam família nenhuma. Duas cópias da lista significariam duas respostas para "quantas compras houve".
2. **Campo novo interessante da Meta entra no field set IMEDIATAMENTE**, mesmo sem coluna. Capturar é irreversível no tempo (a janela de 37 meses desliza um dia por dia); promover não é — o script `scripts/backfill-metric-columns.ts` promove retroativamente, em lotes idempotentes e retomáveis, reusando a mesma função de extração.
3. **`NULL` é "não reportado", não zero.** Dia de campanha de mensagens não tem compra; gravar `0` apagaria a diferença entre "não se aplica" e "tentou e não vendeu". O zero-verdadeiro se resolve na leitura, com objetivo e `spend` em mãos.
4. **Conversões personalizadas são a exceção conhecida.** O nome delas é dinâmico por conta (`offsite_conversion.custom.<id>`): não há coluna possível, e elas seguem legíveis só pelo jsonb cru.

Colunas promovidas: funil/comércio (`link_clicks`, `landing_page_views`, `content_views`, `adds_to_cart`, `checkouts_initiated`, `payment_infos_added`, `purchases`, `purchase_value`, `purchase_roas_value`), leads (`leads`, `registrations_completed`), mensagens (`messaging_conversations_started`, `messaging_first_replies`), engajamento (`post_engagements`, `page_engagements`, `post_reactions`, `comments`, `shares`, `post_saves`, `page_likes`), vídeo (`video_views_3s`, `thruplays`, `video_watches_p25/p50/p75/p95/p100`, `video_avg_watch_seconds`) e outros (`estimated_ad_recallers`, `app_installs`, `results`, `cost_per_result_value`). Contagens `integer`, dinheiro e razões `numeric`.

Notas de leitura:

- `results` é o resultado na definição da PRÓPRIA conta: derivado do `indicator` de `cost_per_result` (que nomeia o `action_type` do resultado), com fallback `spend ÷ cost_per_result` e `NULL` quando inderivável.
- `purchase_value` prefere `action_values`; quando a conta não reporta valores mas reporta ROAS, o valor é reconstruído como `roas × spend` **na escrita** (o fallback nasceu na leitura, no ticket 08, e mudou de casa para que a resposta seja uma só).
- `purchase_roas_value` e `cost_per_result_value` levam sufixo porque `purchase_roas`/`cost_per_result` já são o jsonb cru da mesma métrica.
- `video_actions` jsonb é o reservatório das sete famílias de vídeo do field set — todas com a mesma forma, então sete colunas jsonb não comprariam nada, mas ficar só nas colunas escalares deixaria o vídeo fora do reservatório.
- Vídeo e `estimated_ad_recallers` **nascem para frente**: os campos que os alimentam entraram no field set com a `0045`, então dia anterior fica `NULL` — é a data em que a captura começou, não buraco.
- `reach` e `frequency` seguem não agregáveis (pessoas únicas): quem precisar da janela pede a janela inteira à Meta.

### 4.3 `meta_tracking_change_events` — stream unificado de ações

Toda mudança em qualquer nível é uma linha. É a tabela que os propósitos futuros consomem para "o que foi feito, quando, por quê".

- `id`, `user_id`, `account_id`, `entity_level`, `entity_id`, `campaign_id`, `adset_id`, `entity_name`.
- Natureza: `change_kind` (`created | config_change | status_transition | archived | deleted_detected`), `changed_fields` jsonb `{campo: {old, new}}` **pré-computado na coleta**, `from_config_version_id`, `to_config_version_id` (FKs para 4.1; NULL em transições de status puras).
- Origem: `source` (`backoffice_admin | frontend_user | external_detected | system`), `actor_email` (admin/gestor ou usuário), `actor_name_meta` (do activities, quando houver), `note` (**motivo — obrigatório na aplicação quando `source = backoffice_admin`**; NULL quando detectado só via API, conforme decisão).
- Tempo: `occurred_at` (exato quando conhecido — escrita interna ou activities; senão = `detected_at`), `detected_at`, `detection_run_id`.
- Enriquecimento/ligação: `activity_event_id` (FK 4.4), `legacy_edit_log_table` + `legacy_edit_log_id` (ponte com `campaign/adset/ad_creative_edit_logs` no dual-write).
- Índices: `(entity_level, entity_id, occurred_at)`, `(account_id, occurred_at)`, `(user_id, occurred_at)`, `(source)`.

### 4.4 `meta_tracking_activity_events` — eventos crus do `/activities`

- `id`, `account_id`, `user_id`, `event_type`, `translated_event_type`, `event_time`, `actor_id`, `actor_name`, `application_id`, `object_id`, `object_type`, `object_name`, `extra_data` jsonb (opaco), `fetched_at`, `matched_change_event_id` (NULL enquanto não linkado).
- Dedup: unique por hash `(account_id, event_type, event_time, object_id, actor_id)` — o objeto não tem id próprio documentado.
- Poll diário com `since` = 48 h atrás (overlap deliberado + dedup), persistindo tudo, inclusive eventos sem match (billing, audiência etc. — matéria-prima futura).

### 4.5 `meta_tracking_runs` + `meta_tracking_account_coverage` — operação

- `meta_tracking_runs`: `id`, `kind` (`daily | backfill`), `triggered_by` (`cron | script | manual`), `status` (`running | completed | completed_with_errors | failed`), `started_at`, `completed_at`, `error_message`, `summary` jsonb (contas cobertas, entidades vistas, versões criadas, eventos criados, linhas de métricas upsertadas, contas puladas e parada por orçamento). Runs daily ainda `running` após 14 min são recuperados no tick seguinte; backfills conservam 10 min para acompanhar o TTL renovável do claim.
- `meta_tracking_account_coverage`: `id`, `run_id`, `user_id`, `account_id`, `business_date` date, `status` (`complete | partial | failed | skipped_reconnect | skipped_no_token`), `error_message`, `entities_seen`, `api_calls_used`, `currency`, `timezone_name`, `completed_at`. Unique `(account_id, business_date)`. É a fonte da tela de operação e do claim `onlyStale` (conta sem coverage `complete` hoje = pendente).

### 4.6 `meta_tracking_creatives` — snapshot de criativos

Criativos são imutáveis na prática (sem `updated_time` documentado): uma linha por `creative_id`, buscada quando um ad novo referencia um criativo desconhecido. `id` (creative id Meta), `account_id`, `spec` jsonb (`object_story_spec`, `asset_feed_spec`, `degrees_of_freedom_spec`, `url_tags`, `call_to_action_type`…), `fetched_at`. Permite correlacionar troca de criativo com conteúdo do criativo.

## 5. Coletor diário (pipeline por conta)

Ordem por conta, dentro de um lote de usuários por invocação:

1. **Listagem completa** (1–2 chamadas paginadas): `/act_{id}/campaigns` com adsets/ads aninhados limitados a ids+status (padrão já usado em `refresh-managed-campaigns`). Compara com o último estado conhecido → detecta: entidades novas, transições de `effective_status` (ativo↔pausado/arquivado/deletado; gera `change_events` de `status_transition`/`created`/`archived`), reativações (voltam ao tracking profundo).
2. **Fetch profundo de configs** só das entidades com `effective_status = ACTIVE`: node batch `?ids=a,b,c&fields=…` em chunks de 50, por nível, com o field set do §4.1. Pré-filtro com `updated_since` em `/adsets` e `/ads` quando houver baseline (campanhas sempre completas — `updated_time` não confiável).
3. **Normalização + hash + diff**: config normalizada (ordenação de chaves, remoção de voláteis) → hash; se difere da versão vigente: fecha `valid_to`, abre versão nova, grava `change_event` `config_change` com `changed_fields` calculado campo a campo.
4. **Criativos**: ads novos/alterados com `creative_id` desconhecido → fetch e insert em `meta_tracking_creatives`.
5. **Activities**: `GET /act_{id}/activities?since=−48h` → upsert cru em 4.4 → matcher liga eventos a `change_events` recentes da mesma entidade/janela e preenche `actor_name_meta`/`occurred_at` refinado.
6. **Insights diários**: por nível (`level=campaign|adset|ad`), `time_increment=1`, `time_range` = últimos 28 dias, `use_unified_attribution_setting=true` → upsert em 4.2 (marca `is_final` para dias que saíram da janela). Erro de volume (100/1487534) → chunk por semana → fallback job async.
7. **Coverage**: grava/atualiza `meta_tracking_account_coverage` com status e contadores; erros parciais não derrubam a conta inteira.

Tokens: `getUserAccessTokenByUserId` existente (keyring `META_TOKEN_ENCRYPTION_KEYS` compartilhado); `needs_reconnect`/token expirado → coverage `skipped_reconnect`, sem retry no dia.

Rate limit: ler `X-Business-Use-Case-Usage` / `X-FB-Ads-Insights-Throttle` a cada resposta; acima de ~80 % de utilização da conta → aborta a conta com coverage `partial` e deixa o próximo disparo do cron completar.

## 6. Backfill (13 meses, 3 níveis)

- Job separado (`kind = backfill`), acionável por script (`bun scripts/…`) e processado em janelas noturnas; estado por conta (`business_date` range coberto) para retomada incremental.
- Por conta: insights async job (`POST /act_{id}/insights`, poll do `report_run_id`) por nível, chunk de 1–3 meses, `time_increment=1` → upsert em 4.2 com `is_final = true` (dados >28 d são imutáveis).
- Estado atual de cada entidade (incl. pausadas/arquivadas — só neste momento) vira versão inicial em 4.1 com `valid_from = now` e `change_kind = created` não gerado (flag de baseline no run).
- Orçamento de chamadas por noite por conta para não competir com o coletor diário.

## 7. Escritas internas no stream (ações com motivo)

- **Backoffice** (rotas `meta-marketing`): toda mutação (budget/CBO↔ABO, edição de adset, criativo, rename, duplicate e **status** — corrigindo o gap atual do `PATCH` de status que não loga) passa a: (a) exigir `note` (motivo) no payload; (b) gravar `change_event` com `source = backoffice_admin`, `actor_email`, `occurred_at` exato e `changed_fields`; (c) manter o dual-write na tabela legada correspondente (`campaign/adset/ad_creative_edit_logs`) com a ponte `legacy_edit_log_*`.
- **Frontend** (rotas `meta-business/marketing` do usuário): mesmas escritas com `source = frontend_user`, motivo opcional/ausente.
- Arquivos Meta espelhados: qualquer mudança em fonte espelhada segue o fluxo `sync:meta` (editar no frontend, `bun run sync:meta`, commit conjunto). As rotas de API de cada projeto não são espelhadas — mudam localmente.
- O coletor diário reconhece mudanças já registradas por escrita interna (mesma entidade, mesmo delta, janela ±24 h) e **não** duplica o evento — apenas confirma a versão nova (linka `to_config_version_id`).

## 8. Helpers de correlação (computada na leitura)

Módulo de consulta no backoffice (sem UI analítica na v1):

- `getEntityStateAt(entityLevel, entityId, date)` — versão vigente na data.
- `getEntityTimeline(entityLevel, entityId, range)` — versões + eventos + série diária alinhados.
- `getActionEffect(changeEventId, windowDays)` — agregados N dias antes/depois da ação, com **flag de ações concorrentes** na janela e marcação de reset de learning phase (via `learning_stage_info` das versões).
- `findActions(filtros)` — por campo alterado (`changed_fields ? 'daily_budget'`), source, conta, período.

## 9. Visibilidade mínima (backoffice)

- Página de operação: últimos runs (status, summary), cobertura por conta/dia (falhas, `skipped_reconnect` em destaque — token quebrado é buraco irrecuperável na série), contadores de eventos/versões.
- Na página de marketing existente: histórico unificado de ações da campanha/adset (lendo `meta_tracking_change_events`, substituindo gradualmente os painéis de edit-history legados), com motivo visível.
- RBAC existente (`requireMarketingUserAccessResponse`).

## 10. Agendamento

| Job | Slot (UTC) | Mecanismo |
|---|---|---|
| Coletor diário | `*/15 3-10 * * *` (00:00–07:45 BRT, múltiplos disparos até cobertura completa) | Vercel Cron backoffice, `CRON_SECRET`, `maxDuration 800`, deadline absoluto de 600 s + reserva de finalização, claim por lote + `onlyStale` via coverage |
| Backfill | disparo manual por script + cron noturno temporário durante rollout | idem |

Fora da janela 11:00–12:15 UTC dos 4 crons existentes do backoffice.

## 11. Testes

- Convenção dos repos: `bun test` (runner do bun, suites em `node:test`), colocados junto ao código em `lib/` + contratos em `tests/`.
- **Núcleo crítico (puro, testar pesado)**: normalização de config + hash (estabilidade: mesma config ⇒ mesmo hash; volátil não dispara versão), diff `changed_fields` campo a campo, matcher activities↔eventos, detector de transições de status, cálculo de janelas do upsert de métricas, `is_final`.
- Contratos: rotas de mutação do backoffice/frontend gravam evento + dual-write legado + exigem motivo (backoffice); coletor idempotente (rodar 2× no mesmo dia não duplica versões/eventos/linhas).
- Espelhamento: os dois `schema.ts` permanecem compatíveis (processo manual dos CLAUDE.md; conferir antes de cada commit conjunto).
- Prior art: `managed-campaigns.test.ts`, suites de paridade em `tests/`.

## 12. Fases de entrega (cada uma shippável)

1. **F1 — Schema**: 7 tabelas + migration (backoffice) + espelho no frontend + tipos.
2. **F2 — Coletor mínimo**: listagem, transições, versões + diff + eventos `external_detected`, coverage/runs, cron. (Já entrega "estado em qualquer data" + ações detectadas.)
3. **F3 — Métricas**: upsert diário 28 d nos 3 níveis + `is_final` + fallback async.
4. **F4 — Backfill**: 13 meses por conta, retomável.
5. **F5 — Activities**: poll cru + matcher de enriquecimento.
6. **F6 — Escritas internas**: motivo obrigatório no backoffice, gap do PATCH de status, dual-write, supressão de duplicata no coletor, escritas do frontend.
7. **F7 — Operação**: tela de runs/cobertura + histórico unificado de ações; hardening de rate limit.

## 13. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| `extra_data`/retenção do `/activities` não documentados | Enriquecimento oportunista apenas; diff nunca depende dele; poll diário com overlap 48 h |
| Limite de linhas de insights em contas grandes | Chunk por semana → async job; nível ad é o primeiro a degradar |
| 800 s do Vercel × base crescente | Deadline interno absoluto de 600 s, reserva de finalização, lotes por invocação + cron re-disparando na janela até coverage completa; tudo idempotente |
| Token quebrado = buraco irrecuperável na série de config | Coverage `skipped_reconnect` visível na tela de operação desde a F2 |
| Meta pausará ASC/AAC legadas na v26 (~set/2026) | `advantage_state`/`smart_promotion_type` capturados; onda de `status_transition` esperada, não é bug |
| Renomeio de campanha muda `isManaged` (prefixo) | Flag avaliada por versão (histórico preserva a época em que era gerenciada) |
| Crescimento de volume (linhas diárias × entidades) | Só ativos têm tracking profundo; métricas por dia são compactas; particionamento por data fica como evolução futura se necessário |
| Drift entre os dois `schema.ts` | Processo dos CLAUDE.md (editar ambos, migration no dono, journal sincronizado) |

## 14. Fora de escopo (v1)

- Dashboards analíticos (série temporal com marcadores de ação) — nascem com os consumidores.
- Otimizador, criação enviesada e qualquer consumidor cross-cliente (regra: só via padrões agregados/anonimizados; camada concreta futura).
- Breakdowns (demográficos, hora, placement) e métricas horárias.
- Materialização de efeitos por ação.
- Migração/remoção das tabelas legadas de edit log (dual-write mantém compatibilidade).

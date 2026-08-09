# 03 — Coletor diário mínimo ponta-a-ponta

**What to build:** O primeiro fluxo real de coleta: um cron autenticado no backoffice (janela de madrugada, fora dos crons existentes) e um script manual que percorrem os usuários com conta Meta ativa, listam cada conta de anúncio, buscam a configuração profunda das entidades ativas (pré-filtro de "atualizado desde" apenas em conjuntos e anúncios; campanhas sempre completas), alimentam a costura do delta e persistem o resultado. Runs e cobertura conta×dia registram o que foi coberto; contas com reconexão pendente são puladas e marcadas, nunca silenciosamente ignoradas. Cota respeitada preventivamente pelos headers de uso — interromper com cobertura parcial em vez de gerar erro na Meta (restrição de licença herdada das ADRs).

**Blocked by:** 01 — Schema; 02 — Costura do delta.

**Status:** resolved

- [x] Rodar o script para um usuário real cria versões iniciais, eventos e cobertura `complete` para as contas dele. *(reinterpretado por segurança de ambiente: o script existe (`bun scripts/collect-meta-tracking.ts --user=<id>`, `bun run tracking:collect`) e é executável; o comportamento é coberto por teste puro com portas falsas — **nenhum comando tocou Postgres real nem a Graph API**. Execução real fica no runbook abaixo.)*
- [x] Rodar de novo no mesmo dia não duplica nada e pula contas já cobertas (claim por cobertura, padrão `onlyStale`).
- [x] Múltiplos disparos do cron drenam lotes até cobrir a base, dentro do limite de duração da plataforma; runs travados são recuperados por timeout. *(lote e prazo cobertos por teste; a recuperação de travados é o mesmo `markStuck…RunsFailed` já em produção nos jobs de negócio, verificado por tipagem — exige banco para rodar.)*
- [x] Conta com token inválido/reconexão pendente vira cobertura `skipped_reconnect` com erro registrado.
- [x] Utilização de cota acima do limiar interrompe a conta com cobertura `partial` e o próximo disparo completa.
- [x] Novos status de entidades alimentam o estado anterior da próxima execução (transições detectáveis no dia seguinte).

## Comments

### O que foi entregue

Sete arquivos novos no backoffice, mais duas linhas em `vercel.json` e duas em
`package.json`. Nada fora disso foi tocado.

**As decisões (puras, testadas pesado):**

- **`lib/meta-tracking/quota-usage.ts`** — "quanto da cota já foi gasto?".
  Lê `X-Business-Use-Case-Usage`, `X-FB-Ads-Insights-Throttle`,
  `X-Ad-Account-Usage` e `X-App-Usage` da resposta **bem-sucedida** (é aí que
  ainda dá para parar sem gerar erro) e responde `shouldStopForQuota` no limiar
  de **80 %**.
- **`lib/meta-tracking/daily-collection-plan.ts`** — as outras quatro decisões:
  `planDeepFetch` (quem merece fetch profundo hoje), `buildTrackedEntityStates`
  (o estado anterior, conciliando versão vigente e stream de eventos),
  `isDayCoveredBy` (o claim do dia), `coverageStatusForTokenFailure` e
  `hasCollectionBudgetLeft` (lote e prazo da invocação). Mais
  `LISTING_EFFECTIVE_STATUSES`, a lista de estados pedidos na listagem **por
  nível**.

**A orquestração (fina, injetável):**

- **`lib/meta-tracking/run-daily-collection.ts`** — `runDailyTrackingCollection(ports, options)`.
  Não sabe falar HTTP nem SQL: recebe `DailyCollectionPorts` e chama. É o que
  permite exercitar o pipeline **inteiro** — idempotência, claim, parada por
  cota, pulo por reconexão, drenagem em lotes — sem banco e sem rede.

**Os executores (finos, sem teste unitário por decisão):**

- **`lib/meta-tracking/graph-collector-gateway.ts`** — listagem paginada nos três
  níveis, fetch profundo em node batch de 50, leitura dos headers de cota.
- **`lib/db/meta-tracking-collector-queries.ts`** — runs (com recuperação de
  travados), cobertura conta×dia, estado anterior e a gravação do delta **numa
  transação por conta**.
- **`lib/meta-tracking/daily-collection-ports.ts`** — a composição dos dois.

**As entradas:**

- **`app/api/cron-job/meta-tracking/daily/route.ts`** — `assertCronAuthorized`,
  `maxDuration = 300`, `onlyStale: true`.
- **`scripts/collect-meta-tracking.ts`** — `--all`, `--user=<uuid>` (repetível),
  `--max=<n>`; atalhos `bun run tracking:collect` / `tracking:collect:all`.
- **`vercel.json`** — `*/20 8-10 * * *` (05:00–07:40 BRT), fora da janela
  11:00–12:15 UTC dos quatro crons existentes, como manda o §10 do plano.

**43 testes novos** (`quota-usage` 15, `daily-collection-plan` 14,
`run-daily-collection` 14), `bun:test`, zero banco e zero rede.

### Decisões que valem revisão futura

1. **`failed` é terminal no dia; só `partial` fica pendente.** Foi assim que o
   code-review deixou, e o motivo é duplo: a licença Meta é throttled por taxa
   de erro (reinsistir a cada um dos 9 disparos da madrugada multiplicaria por
   nove os erros de uma conta que falha sistematicamente) e o lote por invocação
   é finito (conta que falha sempre roubaria a vaga de conta nunca tentada).
   Falha transitória volta amanhã; quem quiser hoje roda o script com `--all`.
   `partial` continua pendente porque não é erro — é a parada preventiva.
2. **A listagem são 3 chamadas paginadas por conta** (`/campaigns`, `/adsets`,
   `/ads`), e não a 1–2 com filhos aninhados que o §5.1 do plano sugere.
   Paginar edge aninhado é frágil em conta grande, e o `updated_time` que o
   pré-filtro usa vem de graça nos três. O custo (3–6 chamadas/conta/dia) é
   irrelevante diante da cota BUC por conta.
3. **Recuo de field set**: se a Meta rejeitar o `fields` do fetch profundo com
   erro 100 (campo que saiu do catálogo), o gateway repete **uma vez** com o
   conjunto essencial em vez de perder o dia da conta. Não foi pedido pelo
   ticket; entrou porque o field set do §4.1 **não pôde ser validado contra a
   API real** neste ambiente.
4. **`advantage_state` e `advantage_state_info` são pedidos os dois.** A coluna
   tipada lê o primeiro (aviso 9 do ticket 02); o segundo fica no `config` jsonb
   até alguém ver a forma real dele.

### Avisos para os próximos tickets

1. **O contrato de portas é o ponto de extensão.** `DailyCollectionPorts` é onde
   o **ticket 04** (métricas) e o **06** (activities) entram: some uma porta,
   chame-a dentro de `collectAccount` e some o contador ao resumo do run — a
   chave `metricRowsUpserted` já existe zerada no summary, esperando o 04.
2. **O `last_confirmed_at` de quem foi pré-filtrado NÃO é atualizado**, e isso é
   de propósito: o pré-filtro pergunta "mudou desde a última vez que eu OLHEI de
   verdade?". Refrescar o carimbo sem ter feito o fetch profundo quebraria o
   pré-filtro. Quem for ler essa coluna como "visto hoje" vai se enganar — o que
   responde "vi hoje" é a cobertura conta×dia.
3. **Cobertura de conta sem token usa a timezone de negócio**, não a da conta:
   sem token não há como perguntar a timezone à Meta. Para contas fora do
   Brasil, o `business_date` do `skipped_reconnect` pode cair um dia ao lado do
   das coletas bem-sucedidas. Se algum dia houver conta não-BR, guardar a última
   timezone conhecida da cobertura resolve.
4. **A ordem de varredura é a da paginação de usuários** — sem embaralhamento.
   Se a base crescer além do que a janela cobre, os últimos usuários da ordem
   ficam sistematicamente para trás. Um `ORDER BY` por cobertura mais antiga
   resolveria; hoje não é problema (≈9 disparos × 40 contas > base atual).
5. **O `effective_status` pedido na listagem é a lista documentada por nível.**
   Valor inválido faz a Meta rejeitar a chamada inteira — se a primeira execução
   real acusar erro 100 na listagem, é o primeiro lugar a olhar (não há recuo
   automático aqui, só no fetch profundo).
6. **Índices ainda desejados** (nenhuma migration criada — `db:generate` segue
   quebrado, ver ticket 01): além do GIN em `changed_fields` e do UNIQUE parcial
   em `(entity_level, entity_id) WHERE valid_to IS NULL` já anotados, este
   ticket consulta `meta_tracking_change_events` por `(account_id)` filtrando
   `changed_fields ? 'effective_status'` — o índice `(account_id, occurred_at)`
   existente atende, mas um parcial por esse filtro ajudaria quando o stream
   crescer.

### Runbook da primeira execução real (para o humano)

Nada disto foi rodado: o `.env.local` do backoffice aponta para **produção** e a
migration `0044` ainda não foi aplicada em banco nenhum (ticket 01).

1. Aplicar a migration `0044_meta_tracking_foundation` no alvo escolhido
   (`bun run db:migrate`, nunca `db:push`).
2. `CRON_SECRET` configurado no ambiente.
3. Coleta de um cliente só, olhando a saída:
   `APP_ENV=<alvo> bun scripts/with-env.ts bun scripts/collect-meta-tracking.ts --user=<uuid> --max=1`
4. Conferir: `meta_tracking_runs` (1 linha `completed`),
   `meta_tracking_account_coverage` (1 linha `complete` por conta, com moeda e
   timezone preenchidas), `meta_tracking_config_versions` (1 versão por entidade
   ativa) e `meta_tracking_change_events` (1 `created` por entidade vista).
5. Rodar o **mesmo comando de novo**: a conta deve ser pulada
   (`accountsAlreadyCovered: 1`) e nada novo deve ser gravado.
6. Só então deixar o cron da madrugada rodar sozinho.

### Verificação (ambiente)

Nenhum comando tocou Postgres real nem a Graph API — as costuras são puras e o
orquestrador foi testado com portas falsas.

- `bun test lib/meta-tracking/` → **109/109** (43 novos).
- `bunx tsc --noEmit` → o **mesmo baseline pré-existente** de 11 linhas
  (`portfolio-filters.test.ts`, `users-csv.test.ts` importando `vitest`,
  `frontend-app-url.test.ts`); zero erro nos arquivos deste ticket.
- `bunx eslint` nos arquivos novos → limpo.
- `bun test` completo → 474 testes, 22 falhas, **todas** das suítes de
  integração do Programa de Afiliados, que exigem um Postgres descartável em
  `localhost:55432` via Docker (ausente nesta máquina). Baseline pré-existente,
  nenhuma falha nova, nenhuma em `meta-tracking`.

### Code review

Rodado ao final nos dois eixos (padrões e spec). Dois achados reais, corrigidos
antes do commit: (1) `failed` reinsistido no mesmo dia, que contraria a postura
de cota do plano e ainda deixaria conta que falha roubando vaga de conta nunca
tentada — agora terminal no dia; (2) `businessDate` como `string` onde o repo já
tem o tipo `DayKey`. Mantidos conscientemente: a duplicação parcial com
`parseRateLimitHeaders` (ele só lê o tempo de espera de quem **já** tomou
bloqueio, e mora num módulo que arrasta `next/server` para dentro de uma costura
pura — está documentado no cabeçalho) e o acumulador mutável do orquestrador,
que é o mesmo padrão de `runPerformanceDropBatch`.

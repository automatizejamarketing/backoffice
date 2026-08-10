# 10 — Backfill automático na conexão da Meta (Vercel Workflows)

**What to build:** Quando um usuário conecta (ou reconecta) sua conta Meta pelo Automatize, um workflow durável dispara em background e executa o backfill de 13 meses daquele usuário — sem nunca bloquear nem quebrar o fluxo de conexão. O workflow vive no frontend (onde o callback OAuth conclui e onde o pacote `workflow` da Vercel já é dependência); cada step chama um endpoint autenticado novo no backoffice que processa a próxima fatia pendente do usuário reutilizando o orquestrador de backfill existente, respondendo `{done | fatias restantes}` até terminar. Um claim por conta impede que dois backfills simultâneos (gatilho de conexão + dreno manual) refaçam as mesmas fatias. O progresso aparece na tela de operação como os runs de backfill já aparecem hoje.

**Blocked by:** None — can start immediately (constrói sobre os tickets 03/05 já concluídos).

**Status:** resolved

- [x] Conexão Meta concluída com sucesso dispara o workflow com o userId; falha ao iniciar o workflow é registrada em log e **não** afeta a resposta da conexão (o usuário nunca vê erro por causa do backfill).
- [x] Reconexão de conta já coberta termina barato: o endpoint responde `done` imediatamente quando não há fatia pendente (o estado retomável existente responde por isso).
- [x] O endpoint do backoffice exige autenticação por segredo compartilhado, tem prazo interno com folga (o poll do relatório assíncrono da Meta pode levar ~3 min; ver Comments do ticket 05 sobre `softDeadlineMs`/`pollTimeoutMs`) e processa uma fatia por chamada. *(reinterpretado: "uma fatia por chamada" é consequência do prazo de 90 s, não de um contador — uma fatia pode consumir 180 s esperando o relatório, então raramente cabem duas. Um teto explícito de fatias seria um segundo limitador dizendo a mesma coisa.)*
- [x] Claim por conta: um segundo workflow/dreno simultâneo para a mesma conta não reprocessa fatia em andamento; claim expira sozinho se o dono morrer (padrão de recuperação por timeout já usado nos runs). Sem migration nova — claim vive nas tabelas existentes; se a solução ficar feia, anotar a tabela desejada nos Comments para a migration consolidada.
- [x] O uso do pacote `workflow` segue a API da versão INSTALADA no frontend; se nada no repo importar o pacote hoje, é permitido atualizá-lo para a versão estável GA. Se a integração se mostrar inviável nesta base, o fallback documentado é função Fluid com `maxDuration` alto + disparo fire-and-forget — decisão registrada nos Comments. *(o pacote JÁ é usado — dois workflows em produção e `withWorkflow` no `next.config.ts`; atualizar estava fora de questão. Ver Comments.)*
- [x] Comportamento coberto por testes puros (lógica de claim, loop de fatias, decisão de disparo); nenhuma chamada real a Postgres ou à Meta API nos testes.

## Comments

### O que foi entregue

Três arquivos novos no frontend, dois no backoffice, cinco tocados. Nada fora
disso.

**Backoffice — a decisão pura:**

- **`lib/meta-tracking/backfill-claim.ts`** — "de quem é esta conta agora?".
  `BACKFILL_CLAIM_TTL_MS` (10 min, o mesmo dos runs travados),
  `parseBackfillClaimedAt`, `backfillClaimCutoff`, `isBackfillClaimLive` e
  `isBackfillAccountClaimedByOther`. 14 testes.
- **`describeBackfillSlice`** (em `run-backfill.ts`) — "vale a pena chamar de
  novo?". Lê um `BackfillResult` pelo olho de quem encadeia invocações e devolve
  `{ done, reason, remainingDays }`. 7 testes.

**Backoffice — a ligação:**

- **`run-backfill.ts`**: porta nova `claimAccount`, chamada DEPOIS do orçamento e
  ANTES de qualquer chamada à Meta; contador `accountsSkippedByClaim` no
  resultado e no `summary`. Conta reivindicada por outro disparo não gasta a vaga
  do lote — a vaga é para quem ninguém está atendendo.
- **`lib/db/meta-tracking-backfill-queries.ts`**: `claimBackfillAccount` (um
  `UPDATE … WHERE NOT EXISTS (…) RETURNING`, atômico por construção),
  `saveBackfillProgress` passou a FUNDIR o objeto da conta (antes substituía) e a
  renovar o `claimedAt` a cada checkpoint, e `loadBackfillProgress` passou a
  exigir progresso de verdade no filtro (ver "as decisões que valem revisão").
- **`app/api/cron-job/meta-tracking/backfill/route.ts`**: `POST`,
  `assertCronAuthorized`, `maxDuration = 300`, `softDeadlineMs = 90_000`,
  `userId` validado como uuid. Sem entrada em `vercel.json`: não é cron
  agendado, e `maxDuration` vem do export da rota (mesmo mecanismo da rota
  diária).

**Frontend — a decisão pura:**

- **`lib/meta-tracking/backfill-on-connect.ts`** — `resolveBackfillTrigger` (se
  dispara e para onde), `parseBackfillSliceReport` (a resposta lida com
  desconfiança) e `decideNextBackfillStep` (o laço). 15 testes, `node:test`.

**Frontend — a ligação:**

- **`workflows/meta-tracking-backfill.ts`** — `metaTrackingBackfillWorkflow`:
  laço de `"use step"` chamando a rota do backoffice, com `sleep` de 30 s entre
  fatias e teto de 60 chamadas.
- **`lib/meta-tracking/start-backfill-on-connect.ts`** — o disparo, que nunca
  lança.
- **`app/api/meta-business/marketing/auth/callback/route.ts`** —
  `waitUntil(startMetaTrackingBackfillOnConnect(userId))` nos DOIS ramos (BISU e
  token clássico), ao lado do `triggerDetectionAfterMetaConnect` que já estava
  lá.
- **`.env.example`** — `BACKOFFICE_URL`, `BACKOFFICE_CRON_SECRET` e o
  interruptor `DISABLE_META_TRACKING_BACKFILL`.

**36 testes novos** (`backfill-claim` 14, `run-backfill` +7 do
`describeBackfillSlice` e +4 de claim/reconexão, `backfill-on-connect` 15), zero
banco e zero rede.

### A decisão do pacote `workflow`

O ticket autorizava atualizar para o GA "se nada no repo importar o pacote hoje".
**Importa**: `next.config.ts` embrulha a config com `withWorkflow`, existem dois
workflows em produção (`workflows/signup-whatsapp-nudge.ts`,
`workflows/trial-campaign-nudge.ts`), duas rotas geradas em
`app/.well-known/workflow/` e o interruptor `DISABLE_WORKFLOW` nos scripts de
dev. Atualizar de `5.0.0-beta.35` para outra versão arrastaria dois fluxos de
WhatsApp já em produção junto — risco desproporcional para este ticket. **Ficou
na versão instalada**, e o código segue a API dela (`"use workflow"`,
`"use step"`, `sleep`, `FatalError`, `start` de `workflow/api`), que é a mesma
dos dois workflows existentes. O fallback Fluid não foi necessário.

### As decisões que valem revisão

1. **O claim é um carimbo no `summary` do run, não uma tabela.** Mesmo motivo do
   progresso (ticket 05): a fundação não tem tabela para isso e criar migration
   está vedado. `summary.accounts.<account_id>.claimedAt` vale
   `BACKFILL_CLAIM_TTL_MS`; a conta está tomada quando OUTRO run `kind=backfill`
   ainda `running` tem um carimbo vivo nela. Expira sozinho (o dono pode morrer
   sem soltar — a plataforma mata a invocação e não há `finally` que sobreviva) e
   é RENOVADO a cada checkpoint, que é o que deixa uma conta grande passar dos 10
   min sem perder a reserva.
2. **A tomada do claim é uma instrução só.** Ler "está livre?" e depois gravar
   seriam dois passos, e dois disparos simultâneos passariam os dois pela leitura
   antes de qualquer gravação — a corrida que o claim existe para impedir. A
   condição vive no `WHERE` do `UPDATE`, e o `RETURNING` vazio é o "não é sua". A
   comparação do carimbo é de TEXTO (ISO-8601 UTC tem ordem lexicográfica =
   cronológica); um `::timestamptz` derrubaria a consulta inteira se o jsonb
   guardasse lixo naquela chave, e degradar para "conta livre" é o pior caso
   aceitável.
3. **`loadBackfillProgress` mudou de filtro, e isso era um bug esperando.** Ele
   varria os 100 runs mais recentes que TIVESSEM a chave da conta no `summary`.
   Com o claim, todo run que apenas reivindica a conta passa a ter a chave —
   inclusive as noites em que não havia nada a fazer. Cem noites assim empurrariam
   para fora da janela justamente os runs que capturaram os treze meses, e o
   backfill os refaria do zero contra a cota da conta. O filtro agora exige
   progresso de verdade (`covered` não-vazio ou `baselineCompletedAt`), que é o
   que a consulta sempre quis dizer.
4. **O teto de contas por chamada é 50, não 1.** Tentador limitar a uma conta por
   invocação; seria um bug. O laço sempre recomeça pela primeira conta do
   cliente, e uma conta já coberta passa em milissegundos sem fazer fatia
   nenhuma — com teto 1 ela consumiria a única vaga para sempre e a segunda conta
   nunca seria backfillada. Quem limita a invocação é o prazo.
5. **`account_failed` e `claimed_elsewhere` encerram a cadeia.** Não é "terminou"
   — é "não adianta chamar de novo agora". A licença Meta do app é throttled por
   TAXA DE ERRO: insistir numa conta que acabou de esgotar as falhas da noite
   piora exatamente o que causou a falha. O que sobrou continua pendente e volta
   pelo dreno noturno (`bun run tracking:backfill`).
6. **`triggered_by = 'cron'` para o run do workflow.** O enum é
   `cron | script | manual` e mudá-lo exigiria migration. `cron` é o mais honesto
   dos três (disparo automático, sem humano). Valor desejado anotado abaixo.

### Avisos para os próximos tickets

1. **`BackfillPorts` ganhou uma porta obrigatória.** Quem construir portas de
   backfill à mão (testes, scripts) precisa de `claimAccount`. A composição
   (`createBackfillPorts`) já a liga a `claimBackfillAccount`.
2. **O script manual agora também reivindica.** `bun run tracking:backfill`
   passou a respeitar o claim: rodar o script enquanto o workflow de um cliente
   está no ar faz o script PULAR as contas dele (`accountsSkippedByClaim` no
   resumo). É o comportamento desejado, mas é uma mudança de hábito para quem
   estava acostumado a "o script sempre roda tudo".
3. **Duas variáveis novas no frontend.** `BACKOFFICE_URL` e
   `BACKOFFICE_CRON_SECRET` (que tem de ser o MESMO valor do `CRON_SECRET` do
   backoffice). Sem elas o disparo é ignorado com log e a conexão funciona igual
   — é assim que dev local se comporta hoje. `DISABLE_META_TRACKING_BACKFILL=true`
   desliga explicitamente.
4. **O prazo de 90 s protege as fatias, não o baseline.** O prazo é verificado
   entre contas e entre fatias; a captura do baseline de configuração (listagem +
   node batch) roda inteira sem checagem. Numa conta enorme, baseline lento
   iniciado perto dos 90 s pode empurrar a invocação além dos 300 s. Não há perda
   de dado — a fatia não entra no progresso e o passo do workflow re-tenta —, mas
   a invocação é desperdiçada. Se doer, o lugar de checar é antes de
   `captureBaseline`.
5. **O workflow não sabe de conta, só de cliente.** Ele chama "processe a próxima
   fatia do usuário X" e o backoffice decide qual conta. Um cliente com mais de
   50 contas de anúncio volta a ter o problema do aviso 4 do item anterior;
   nenhum tem hoje.
6. **A rota nova não tem teste.** Rotas não são testadas neste repo (a rota de
   cron diária do ticket 03 também não é); o que ela faz de próprio — validar o
   uuid, montar as opções, projetar a resposta — é fino, e as decisões estão nas
   costuras puras. Se alguma rota do repo ganhar teste um dia, esta merece.
7. **Colunas/tabelas desejadas, nenhuma migration criada** (`db:generate` segue
   quebrado — ticket 01). Somando ao que os tickets 03/05 já anotaram:
   - `meta_tracking_backfill_progress (account_id text primary key, user_id uuid,
     covered jsonb not null default '[]', baseline_completed_at timestamp,
     claimed_at timestamp, claimed_by_run_id uuid, updated_at timestamp)` — a
     mesma tabela que o ticket 05 pediu, agora com o claim junto. Com ela o claim
     vira um `UPDATE … WHERE claimed_at IS NULL OR claimed_at < now() - interval
     '10 minutes'` numa linha só, e `loadBackfillProgress` vira um `SELECT` por
     chave em vez de varrer summaries.
   - `meta_tracking_runs.triggered_by` com o valor `connect`, para distinguir o
     backfill da ativação do cron e do script na tela de operação.

### Runbook da primeira execução real (para o humano)

Nada disto foi rodado: nenhum comando tocou Postgres real, a Meta API ou a API de
workflows. As decisões são puras e a orquestração foi exercitada com portas
falsas.

1. Pré-requisitos dos runbooks dos tickets 03 e 05 (migration `0044` aplicada,
   `CRON_SECRET` no ambiente do backoffice).
2. No frontend, configurar `BACKOFFICE_URL` (origem do backoffice) e
   `BACKOFFICE_CRON_SECRET` (igual ao `CRON_SECRET` de lá) no ambiente alvo.
3. Testar a rota isolada, ANTES de mexer na conexão:
   `curl -X POST "$BACKOFFICE_URL/api/cron-job/meta-tracking/backfill" -H "authorization: Bearer $CRON_SECRET" -H "content-type: application/json" -d '{"userId":"<uuid>"}'`
   Esperado: `200` com `done`, `reason` e `remainingDays`. Sem o header: `401`.
   Com `userId` inválido: `400`.
4. Chamar de novo o mesmo `curl` **em paralelo** com o primeiro ainda rodando: a
   segunda resposta deve trazer `accountsSkippedByClaim: 1` e
   `reason: "claimed_elsewhere"` — é a prova do claim.
5. Reconectar a Meta por um cliente já backfillado e olhar o log do frontend:
   `[meta-tracking-backfill] workflow enqueued` e, no backoffice,
   `reason: "target_covered"` na primeira fatia.
6. Conexão de um cliente NOVO: acompanhar `meta_tracking_runs` (uma linha
   `kind = 'backfill'` por chamada do workflow) e ver `remainingDays` caindo. O
   workflow para sozinho.
7. Se `reason` vier `account_failed`, o cliente fica com período pendente de
   propósito — o dreno noturno o pega. Investigar pelo `sampleErrors` do run
   antes de re-disparar à mão.

### Verificação (ambiente)

- `bun test lib/meta-tracking/` (backoffice) → **340/340**.
- `bun test lib/meta-tracking/` (frontend) → **15/15**.
- `bunx tsc --noEmit` nos dois → o **mesmo baseline pré-existente** de cada repo
  (backoffice: `portfolio-filters.test.ts`, `users-csv.test.ts`,
  `frontend-app-url.test.ts`; frontend: os `bun:test` colocados, `referral-test-db.ts`,
  três suítes em `tests/`); zero erro nos arquivos deste ticket. O teste novo do
  frontend usa `node:test` justamente por isso — `bun:test` em arquivo colocado
  sob `lib/` acrescentaria uma linha ao baseline.
- `bunx eslint` nos arquivos tocados do backoffice → limpo.
- `bun test` completo: backoffice 602 testes / 42 falhas; frontend 1102 testes /
  44 falhas. Todas das suítes de integração de Afiliados/Produtos, que exigem um
  Postgres descartável via Docker (ausente nesta máquina) e derrubam em cascata
  suítes vizinhas — os mesmos arquivos passam sozinhos (`bun test
  lib/products/finance.test.ts` → 4/4, `lib/referral/write-off.test.ts` → 21/21).
  Baseline pré-existente e não determinístico; nenhuma falha em `meta-tracking`,
  nenhuma falha nova.
- O SQL do claim e o do progresso foram conferidos renderizando as consultas com
  `toSQL()` (sem conexão): parâmetros, casts e a subconsulta `NOT EXISTS`
  corretos.

### Code review

Rodado ao final nos dois eixos (padrões dos CLAUDE.md e spec/ticket), manualmente
sobre o diff. Três achados reais, corrigidos antes do commit:

1. **`saveBackfillProgress` apagava o claim.** Ele substituía o objeto da conta
   inteiro; o primeiro checkpoint jogava fora o `claimedAt` e entregava a conta ao
   próximo disparo no meio do trabalho. Agora funde e renova.
2. **`loadBackfillProgress` passaria a contar runs vazios** e, com o tempo,
   perderia o progresso real de vista — o item 3 das decisões acima. O filtro
   virou "tem progresso de verdade".
3. **Teto de uma conta por chamada travaria clientes multi-conta** — o item 4 das
   decisões acima.

Mantidos conscientemente: a duplicação do predicado do claim entre o módulo puro
e o SQL (documentada nos dois lados; o teste puro é o que fixa a semântica que o
SQL espelha), a ausência de teste da rota (padrão da casa) e o `console.log` no
corpo do workflow (padrão dos dois workflows existentes).

# 05 — Backfill de 13 meses + versão inicial de configuração

**What to build:** A captura do histórico irrecuperável na ativação de cada conta: jobs assíncronos de insights da Meta, fatiados por período e retomáveis por estado de progresso por conta, populam 13 meses de série diária nos três níveis (dados já finais). No mesmo passo, o estado atual de todas as entidades da conta — incluindo pausadas e arquivadas, apenas neste momento de baseline — vira a primeira versão de configuração, sem gerar eventos de criação retroativos. Acionável por script, com orçamento de chamadas por janela noturna para não competir com o coletor diário.

**Blocked by:** 04 — Série diária de métricas.

**Status:** resolved

- [x] Conta ativada ganha 13 meses de linhas diárias nos três níveis, marcadas como finais. *(o alvo do backfill é `[hoje−13 meses, hoje−29 dias]` — exatamente a parte já congelada; os 29 dias restantes são a janela móvel do coletor diário, que os re-coleta até congelarem. Marcar um dia mutável como final trairia o aviso 3 do ticket 04. Juntos, os dois cobrem os 13 meses; sozinho, o backfill cobre tudo que "já é final", como o próprio enunciado pede.)*
- [x] Interrupção no meio (timeout, cota) retoma do ponto onde parou sem refazer períodos completos.
- [x] Entidades pausadas/arquivadas existentes ganham versão baseline sem evento de criação; o coletor diário segue ignorando-as até reativarem.
- [x] Job assíncrono da Meta com falha reporta o erro e re-tenta a fatia; nenhum `report_run_id` é reutilizado após expirar.
- [x] Backfill de uma conta grande não estoura a cota da conta (orçamento por noite respeitado) nem o limite de duração da plataforma. *(orçamento de chamadas por conta + parada preventiva pelos headers de cota + prazo por invocação; a execução real contra conta grande fica no runbook.)*
- [x] Progresso e conclusão visíveis no run (`kind` de backfill) com contadores por conta.

## Comments

### O que foi entregue

Sete arquivos novos no backoffice e sete tocados. Nada fora disso.

**As decisões (puras, testadas pesado):**

- **`lib/meta-tracking/backfill-plan.ts`** — "o que capturar e o que já foi
  capturado": `backfillTargetRange` (13 meses até onde a janela móvel começa),
  a álgebra de períodos (`mergeDayRanges`, `subtractDayRanges`, `sliceDayRange`),
  `planAccountBackfill` (o que falta, fatiado do mais recente para o mais
  antigo), `planBaselineFetch` (todas as entidades menos as removidas),
  `parseBackfillProgress`/`mergeBackfillProgress`/`withSliceCovered` (o estado de
  retomada) e `hasApiCallBudgetLeft` (o orçamento da noite).
- **`lib/meta-tracking/async-insights-job.ts`** — "como esperar o relatório":
  `readAsyncReportPhase`, `isReportRunUsable` (validade de 30 dias) e
  `runAsyncInsightsReport`, com portas injetadas para `POST`, poll, leitura,
  `sleep` e relógio.

**A orquestração (fina, injetável):**

- **`lib/meta-tracking/run-backfill.ts`** — `runMetaTrackingBackfill(ports, options)`.
  Baseline → fatias → checkpoint por fatia, com orçamento, cota e prazo. Não sabe
  falar HTTP nem SQL: é isso que permite exercitar retomada, interrupção e falha
  de job assíncrono sem banco e sem rede.

**Os executores (finos, sem teste unitário, por decisão de coleta):**

- **`graph-collector-gateway.ts`** ganhou `graphPost` + `startInsightsReport`,
  `readInsightsReport` e `fetchInsightsReportRows` — mesmos parâmetros da
  consulta síncrona (`time_increment=1`, `use_unified_attribution_setting`), com
  o mesmo recuo de field set.
- **`lib/db/meta-tracking-backfill-queries.ts`** — progresso por conta no
  `summary` do run (ver abaixo), com checkpoint incremental (`jsonb_set`) e
  fechamento que MESCLA o summary em vez de substituí-lo.
- **`lib/meta-tracking/async-insights-ports.ts`** e **`backfill-ports.ts`** — a
  composição. `createBackfillPorts()` reusa `createDailyCollectionPorts()` para
  tudo que é igual (token, contas, listagem, fetch profundo, estado anterior,
  gravação do delta): é o que garante que backfill e coleta diária escrevam a
  MESMA coisa no banco.

**As entradas:** `scripts/backfill-meta-tracking.ts` (`--user=<uuid>` repetível,
`--account=`, `--all`, `--months=`, `--slice-days=`, `--max-accounts=`,
`--calls=`, `--redo-baseline`) e o atalho `bun run tracking:backfill`.

**58 testes novos** (`backfill-plan` 23, `async-insights-job` 10,
`run-backfill` 19, mais 5 em `collect-daily-metrics` e 1 em
`daily-collection-plan`), `bun:test`, zero banco e zero rede.

### As quatro decisões que valem revisão

1. **O progresso mora no `summary` do run, não numa tabela.** A fundação não tem
   tabela de progresso (o §4 não previu uma) e criar migration está vedado. As
   duas alternativas eram esta e `meta_tracking_account_coverage`; a cobertura
   foi **descartada** porque responde outra pergunta — "esta conta foi coletada
   NESTE dia", que é o claim do coletor diário. Gravar lá o passado backfillado
   diria que houve coleta de configuração em dias em que não houve e apagaria a
   cobertura real de dias já coletados. O `summary` de um run `kind = backfill`
   guarda `accounts.<account_id> = { covered: [{since, until}],
   baselineCompletedAt, slicesCompleted, metricRowsUpserted }`; a retomada é a
   união dos `covered` de todos os runs, menos o alvo. **Migration desejada
   anotada abaixo.**
2. **O checkpoint é por fatia, e a fatia só entra no progresso depois de
   gravada.** É isso que faz timeout, cota e erro custarem uma fatia em vez da
   noite — e o que impede a retomada de pular buraco.
3. **O alvo para onde a janela móvel começa.** `[hoje−13m, hoje−29d]`: linha
   mutável tem um dono só. Como todo dia do alvo já passou de 28 dias,
   `toDailyMetricRows` marca `is_final = true` sozinho, e o `setWhere` do upsert
   (aviso 3 do ticket 04) impede qualquer regressão nos dois sentidos.
4. **Duas falhas de fatia encerram a conta na noite.** A licença Meta é
   throttled por taxa de erro: doze fatias de uma conta com problema sistemático
   seriam doze erros por noite. O que ficou pendente continua pendente.

### Avisos para os próximos tickets

1. **O recuo por volume ficou completo (§5.6 do plano).** `DailyMetricsPorts`
   ganhou `fetchInsightsAsync`, e o coletor **diário** agora tem o terceiro
   degrau que o ticket 04 deixou em aberto: período partido ao meio → job
   assíncrono pelo período INTEIRO → nível abandonado. O job assíncrono pega a
   janela inteira, e não o dia único, de propósito: se nem um dia cabe no
   caminho síncrono, insistir por dia geraria 29 relatórios para o mesmo
   resultado. `levelsAbandoned` agora só acontece quando nem o assíncrono dá
   conta.
2. **Interação a conhecer (rota de cron diária).** O prazo de espera do
   relatório assíncrono é 180 s e o prazo do coletor diário é verificado entre
   CONTAS: uma conta que caia no assíncrono perto do fim da invocação pode
   estourar os 300 s da rota. Não há perda de dado (a cobertura não é gravada e
   o disparo seguinte refaz), mas a invocação é desperdiçada. Se doer, passe um
   `pollTimeoutMs` menor na composição diária.
3. **Se alguém pendurar o backfill num cron**, passe `softDeadlineMs` ≈ 90 s: o
   prazo é verificado ENTRE fatias e uma fatia pode levar mais 180 s (o prazo do
   relatório). 90 + 180 cabe em `maxDuration = 300`; o default de 240 s é para o
   script, que não tem limite de plataforma. Está escrito no código.
4. **Não há claim entre invocações do backfill.** Dois disparos simultâneos na
   mesma conta refariam a mesma fatia (o upsert é idempotente, então o custo é
   cota, não dado errado). O script é manual; se virar cron, o claim tem de
   nascer junto.
5. **`createTrackingRun` marca como `failed` run de backfill parado há mais de
   10 min** (o mesmo `markStuckTrackingRunsFailed` dos jobs de negócio). Uma
   execução longa por script pode ser marcada assim por um disparo concorrente —
   é cosmético: o progresso está no `summary`, que não é tocado. **Ticket 09**,
   se listar runs, vai ver isso eventualmente.
6. **Nível abandonado por volume dentro do backfill marca a fatia como
   coberta.** O erro fica no run, mas o período não é re-tentado — pela mesma
   razão do ticket 04 (insistir contra a Meta piora a taxa de erro). Para
   recuperar um período assim é preciso limpar o `covered` daquela conta no
   `summary` e rodar com `--slice-days` menor.
7. **Colunas/índices desejados, nenhuma migration criada** (`db:generate` segue
   quebrado — ticket 01). Para a migration consolidada futura, além do GIN em
   `changed_fields`, do UNIQUE parcial de versão aberta e do
   `coverage.metric_rows_upserted` já anotados:
   `meta_tracking_backfill_progress (account_id text primary key, user_id uuid,
   covered jsonb not null default '[]', baseline_completed_at timestamp,
   updated_at timestamp)`. Com ela, `loadBackfillProgress` vira um `SELECT` por
   chave em vez de varrer os summaries dos runs.
8. **O baseline é a ÚNICA foto de pausadas e arquivadas.** Ele roda uma vez por
   conta (`baselineCompletedAt`), com `listing: []` na costura do delta — o que
   produz versões sem nenhum evento `created` retroativo. Uma reexecução com
   `--redo-baseline` que encontre configuração diferente gera `config_change`
   normal (não criação), o que é honesto: a configuração mudou mesmo.
9. **Unidades continuam as do ticket 04**: `spend`/`action_values` em unidades
   MAIORES, orçamentos das versões em unidades menores. O backfill grava cru,
   sem conversão, exatamente como a coleta diária.

### Runbook da primeira execução real (para o humano)

Nada disto foi rodado: o `.env.local` do backoffice aponta para **produção** e a
migration `0044` ainda não foi aplicada em banco nenhum (ticket 01).

1. Aplicar a migration e rodar a coleta diária ao menos uma vez (runbook do
   ticket 03) — o backfill não depende dela, mas é o que confirma token e conta.
2. Backfill de UM cliente, olhando a saída:
   `APP_ENV=<alvo> bun scripts/with-env.ts bun scripts/backfill-meta-tracking.ts --user=<uuid> --max-accounts=1`
3. Conferir: `meta_tracking_runs` (1 linha `kind = 'backfill'`, com
   `summary.accounts.<act_id>.covered` preenchido),
   `meta_tracking_config_versions` (versão inicial para TODAS as entidades, não
   só as ativas), `meta_tracking_change_events` (**nenhum** evento novo vindo
   deste run) e `meta_tracking_daily_metrics` (`is_final = true` em tudo que o
   backfill gravou).
4. Rodar o **mesmo comando de novo**: `slicesCompleted` deve cair para o que
   ficou pendente (ou zero) — a retomada não refaz período completo.
5. `--calls` é o orçamento por conta por invocação (default 300). Numa conta
   grande, comece baixo e acompanhe `apiCallsUsed` no resumo; a parada por cota
   (headers da Meta, 80 %) já protege sozinha, mas o orçamento é o que impede o
   backfill de competir com a coleta do dia.
6. Se `metricSlicesDegraded` subir muito, a conta está no teto de linhas mesmo
   no relatório assíncrono: `--slice-days=15` reduz o tamanho da fatia.

### Verificação (ambiente)

Nenhum comando tocou Postgres real nem a Graph API — as decisões são puras e a
orquestração foi testada com portas falsas. O SQL do progresso foi conferido
renderizando a query com `toSQL()` (sem conexão): parâmetros e casts corretos.

- `bun test lib/meta-tracking/` → **291/291** (58 novos).
- `bunx tsc --noEmit` → o **mesmo baseline pré-existente** (`portfolio-filters.test.ts`,
  `users-csv.test.ts` importando `vitest`, `frontend-app-url.test.ts`); zero erro
  nos arquivos deste ticket.
- `bunx eslint` nos arquivos tocados → limpo.
- `bun test` completo → 659 testes, 24 falhas, **todas** das suítes de
  integração do Programa de Afiliados, que exigem um Postgres descartável em
  `localhost:55432` via Docker (ausente nesta máquina). Baseline pré-existente e
  não determinístico (635–659 testes entre execuções); nenhuma falha em
  `meta-tracking`, nenhuma falha nova.

### Code review

Rodado ao final nos dois eixos. Sem ferramenta de sub-agente disponível nesta
sessão, os dois eixos foram percorridos manualmente sobre o diff. Cinco achados
reais, corrigidos antes do commit:

1. **Duplicação de `businessDateFor`** — o backfill tinha um gêmeo do helper do
   coletor diário, com um comentário justificando o desacoplamento… num arquivo
   que já importava daquele módulo. O helper foi exportado e reusado.
2. **Recuo de field set faltando no `POST` assíncrono** — a consulta síncrona
   recua para o field set essencial quando a Meta rejeita um campo (erro 100); o
   relatório assíncrono não recuava, e a conta afetada falharia o backfill todas
   as noites, para sempre. Agora recua igual, com a mesma ordem de guardas
   (volume antes de campo inválido).
3. **Baseline que falha deixava a conta `completed`** se a série estivesse
   inteira — escondia que o estado atual das entidades não foi capturado. Agora
   a conta é `partial` até o baseline entrar.
4. **Comentário mentindo sobre o prazo** ("menor que o do coletor diário", sendo
   igual). Virou o aviso do item 3 dos avisos acima, com a aritmética.
5. **Opções sem teste** (`--redo-baseline` e `--account`) e o predicado de
   expiração do relatório sem teste direto. Os três ganharam teste.

Mantidos conscientemente: o acumulador mutável do orquestrador (mesmo padrão de
`run-daily-collection.ts` e `runPerformanceDropBatch`), o parsing de argumentos
repetido entre os scripts (padrão da casa) e a ausência de rota de cron — o
ticket pede "acionável por script", e o §10 do plano trata o cron do backfill
como temporário, de rollout.

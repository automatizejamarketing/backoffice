# 09 — Tela de operação + histórico unificado de ações

**What to build:** A visibilidade mínima para operar a fundação com confiança, no backoffice e sob o RBAC existente. Uma página de operação mostra as execuções recentes (status, contadores, duração, erros) e a cobertura conta×dia, com contas em reconexão pendente em destaque — token quebrado é buraco irrecuperável na série e precisa aparecer no dia. Na página de marketing existente, um painel de histórico unificado por campanha/conjunto lê o stream de ações e mostra cada ação com origem, autor, motivo (quando houver) e diff resumido, substituindo a leitura fragmentada dos logs legados.

**Blocked by:** 03 — Coletor diário; 07 — Ações internas.

**Status:** resolved

- [x] Operador vê os últimos runs com summary e distingue completo, parcial e falho. *(`completed_with_errors` do banco é lido como **parcial**; `running` ganha um quarto estado com duração decorrida. Coberto por teste puro — **nada foi renderizado contra banco real**.)*
- [x] Cobertura conta×dia evidencia buracos e contas `skipped_reconnect` em destaque acionável.
- [x] Histórico de uma campanha lista ações de todas as origens em ordem temporal, com motivo visível quando existir e autor enriquecido quando disponível.
- [x] Acesso respeita o RBAC de marketing existente; página pesada mantém a diretiva de renderização dinâmica do padrão do projeto.
- [x] Estados vazios e de erro tratados (conta sem coleta ainda, run em andamento).

## Comments

### O que foi entregue

**Duas costuras puras (testadas):**

- **`lib/meta-tracking/operation-view.ts`** — `summarizeTrackingRun` (estado, duração,
  contadores lidos defensivamente do `summary` jsonb), `coverageDayRange` +
  `buildCoverageGrid` (a grade conta×dia, os buracos e a ordenação por urgência) e
  `filterCoverageRowsForActor` (o recorte de RBAC). 14 testes.
- **`lib/meta-tracking/action-history-view.ts`** — `buildActionHistory` (origem, autor,
  motivo, diff em vocabulário de gestor, marca de falha) e `mergeActionStreams` (a união
  das duas consultas que formam o histórico de um escopo). 12 testes.

**Invólucro fino:** `lib/db/meta-tracking-operation-queries.ts` — `listRecentTrackingRuns`,
`listAccountCoverage` (com o email do cliente por `leftJoin`) e `getAccountTrackingCurrency`.

**A tela:** `app/(admin)/marketing/tracking/` (`page.tsx` server + `tracking-operation-client.tsx`),
com `export const dynamic = "force-dynamic"`, `requirePagePermission("marketing:read")` e entrada
"Coleta Meta" no `app-sidebar.tsx`.

**O painel:** `app/(admin)/marketing/components/action-history-panel.tsx` (react-query) +
`app/api/meta-marketing/[accountId]/tracking-history/route.ts` (`requireMarketingUserAccessResponse`),
montado no `campaign-detail.tsx` e no `adset-detail.tsx`.

### Decisões que valem revisão futura

1. **A grade só enxerga quem já foi coletado.** `buildCoverageGrid` nasce das linhas de
   cobertura, então "conta conectada que o coletor nunca alcançou" não aparece — ela é
   invisível, não um buraco. Dias anteriores à primeira linha da conta viram `untracked`
   (traço pontilhado), nunca buraco: contar como falha o período em que a conta ainda não
   existia no tracking seria alarme falso. Quem quiser cobrar contas nunca coletadas
   precisa cruzar com `meta_business_accounts` — é outra pergunta, e outra consulta.
2. **`partial` conta como dia incompleto.** A parada preventiva por cota não é erro, mas
   também não é dia fechado: parte da configuração daquele dia não foi observada. Aparece
   em âmbar, separado do vermelho de token quebrado, e `daysMissing` isola o silêncio
   absoluto (nenhuma linha) do resto.
3. **O RBAC recorta em memória, não em SQL.** `listAccountCoverage` traz o período inteiro
   e `filterCoverageRowsForActor` aplica `canAccessMarketingUser` — a MESMA função das
   rotas de marketing. Repetir a regra em SQL faria a tela poder discordar das rotas.
   Custo atual: ~40 contas × 14 dias. Se a base crescer uma ordem de grandeza, empurrar
   `userId IN (...)` para a consulta é a evolução — mantendo a função pura como autoridade.
4. **O erro de carga não vai para a tela.** Mensagem de erro de Postgres carrega host e às
   vezes credencial; a tela diz que falhou e manda olhar o log do servidor. Como a
   migration `0044` ainda não foi aplicada em ambiente nenhum, **este é o estado que a tela
   mostra hoje**: alerta de falha + grade vazia. É comportamento correto, não bug.
5. **O painel legado do conjunto continua na tela**, agora rotulado "Edições pelo backoffice
   (registro legado)". O plano diz "substituindo **gradualmente**" — remover hoje deixaria a
   gaveta sem histórico nenhum até a coleta rodar, porque o stream começa vazio. Quando
   houver histórico suficiente, apagar a seção legada é uma linha.
6. **O histórico de uma campanha são duas consultas.** A campanha guarda `campaign_id` nulo
   e os filhos o carregam, então "tudo que aconteceu nesta campanha" é a união de
   `entityId = X` com `campaign_id = X`. `mergeActionStreams` deduplica por id, ordena e
   corta — o corte tira as mais antigas, nunca as mais recentes.

### Avisos para os próximos tickets

1. **O contrato serializado é único e derivado.** `SerializedTrackingRunView`,
   `SerializedCoverageGrid` e `SerializedActionHistoryItem` são `Omit<...>` das vistas puras,
   morando no módulo puro e importados pelos dois lados. Campo novo na vista aparece
   automaticamente na tela em vez de sumir em silêncio — **não reescreva a forma à mão**.
2. **A chave de react-query do painel fica sob `marketingKeys.all(accountId, userId)`** de
   propósito: toda mutação de marketing já invalida essa raiz, então o histórico recarrega
   sozinho depois de uma edição. Chave nova fora dessa raiz não recarrega.
3. **`summary` do run é lido por chave conhecida, e valor com tipo errado vira zero** (não
   `NaN`, não `"18"` coagido). Contador novo escrito pelo orquestrador precisa entrar em
   `COUNTER_KEYS` de `operation-view.ts` para aparecer na tela — hoje a lista cobre os treze
   que `runDailyTrackingCollection` escreve, incluindo `metricSlicesDegraded` e `eventsLinked`.
4. **Rótulo de campo do diff é um mapa pt-BR** (`FIELD_LABELS`). Campo da Graph API fora da
   lista aparece com o nome cru — honesto, mas feio. Ticket que registrar campo novo em
   `changed_fields` deveria acrescentar o rótulo junto.
5. **Dinheiro na tela vem em unidades menores.** `daily_budget`, `lifetime_budget`,
   `spend_cap`, `budget_remaining` e `bid_amount` são divididos por 100 e formatados na moeda
   da conta (`meta_tracking_account_coverage.currency`, com fallback BRL). Campo monetário
   novo precisa entrar em `MINOR_UNIT_MONEY_FIELDS` ou vai aparecer cem vezes maior.
6. **Nenhum índice novo pedido por este ticket.** As consultas usam
   `(started_at)`, `(business_date, status)` e `(account_id, occurred_at)`, todos existentes.
   Os índices já anotados nos tickets 01/03/07/08 (GIN em `changed_fields`, UNIQUE parcial da
   versão vigente, parcial por `source` interno) seguem valendo para a migration consolidada.

### Runbook para o humano (o que exige banco de verdade)

Nada disto foi executado: a migration `0044_meta_tracking_foundation` continua sem ser
aplicada em banco nenhum e o `.env.local` do backoffice aponta para produção.

1. Aplicar `0044_meta_tracking_foundation` no alvo escolhido (`bun run db:migrate`).
2. Abrir `/marketing/tracking` como admin: com a migration aplicada e sem coleta ainda, a
   tela deve mostrar os dois estados vazios ("Nenhuma execução registrada ainda" e "Nenhuma
   conta coletada no período"), **sem** alerta de erro.
3. Rodar a coleta de um cliente (runbook do ticket 03) e recarregar: 1 execução `Completa`
   com contadores, e a conta com o dia de hoje verde.
4. Abrir a gaveta de uma campanha no `/marketing` do usuário: "Histórico de Ações" deve
   listar os eventos `created` da coleta. Pausar a campanha pelo backoffice com motivo e
   recarregar: a ação aparece no topo, com origem "Backoffice", autor e o motivo entre aspas.
5. Conferir o recorte de RBAC com um `marketing_consultant`: em `/marketing/tracking` ele só
   pode ver contas dos clientes atribuídos a ele.

### Verificação (ambiente)

Nenhum comando tocou Postgres real nem a Graph API — as costuras são puras e a página não
foi renderizada. `bun run build` **não** foi rodado de propósito: o build renderiza páginas
e o ambiente padrão do backoffice aponta para produção.

- `bun test lib/meta-tracking/` → **287/287** (26 novos: 14 de operação, 12 de histórico).
- `bunx tsc --noEmit` → zero erros nos arquivos deste ticket (o baseline pré-existente de
  `portfolio-filters.test.ts`, `users-csv.test.ts` e `frontend-app-url.test.ts` permanece).
- `bunx eslint` nos arquivos novos e editados → limpo (os dois warnings de `<img>` do
  `app-sidebar.tsx` são pré-existentes, no logo).
- `bun test` completo → 508 pass / 66 fail, **todas** as falhas nas suítes de integração do
  Programa de Afiliados e nas `node:test` que elas derrubam em cascata (Postgres descartável
  em `localhost:55432` via Docker, ausente nesta máquina). Baseline pré-existente; nenhuma
  falha em `meta-tracking`.

### Code review

Rodado ao final nos dois eixos (padrões do repo + spec). Quatro achados reais, corrigidos
antes do commit: (1) o comparador "mais recente primeiro" estava duplicado dentro de
`mergeActionStreams`; (2) as formas serializadas estavam escritas à mão no componente
cliente, livres para divergir da vista pura — viraram `Omit<...>` no módulo puro; (3)
`needsReconnect` fazia ginástica de tipo com três condições onde um predicado resolve; (4)
a mensagem crua do erro de banco ia para a tela, podendo vazar host/credencial — agora só
para o log. Mantido conscientemente: a `<table>` crua da grade (padrão já usado em
`users-table.tsx` e `business-rules-page-client.tsx`; a grade tem células de largura fixa
que o `Table` do shadcn não ajuda a montar).

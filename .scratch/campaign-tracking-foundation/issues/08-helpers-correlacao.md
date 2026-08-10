# 08 — Helpers de correlação (computada na leitura)

**What to build:** O módulo de consulta que torna a base utilizável pelos propósitos futuros sem materializar metodologia: estado vigente de qualquer entidade em qualquer data (consulta de vigência), linha do tempo unificada (versões + ações + série diária alinhadas), janelas de N dias antes/depois de uma ação com sinalização de ações concorrentes na janela e de reset de fase de aprendizado, e busca de ações por campo alterado, origem, conta e período. O núcleo de cálculo é puro (série + eventos ⇒ janelas e flags) — a costura 3 —, com invólucros finos de consulta ao banco.

**Blocked by:** 01 — Schema da fundação.

**Status:** resolved

- [x] Estado-na-data retorna a versão vigente correta em datas de fronteira (dia da mudança, antes da primeira versão, depois da última).
- [x] Janela antes/depois usa apenas dias com dado e informa quantos dias de cada lado existem de fato.
- [x] Ação com outra ação na mesma janela vem sinalizada como confundida; reset de fase de aprendizado na janela vem sinalizado.
- [x] Busca por campo alterado encontra ações via diff pré-computado, sem comparar configurações em consulta. *(query implementada e conferida pelo SQL renderizado — `jsonb_exists_any` sobre `changed_fields`; **não executada contra banco**, por segurança de ambiente — ver Comments)*
- [x] Casos de borda testados na costura pura com séries sintéticas: ação no primeiro/último dia da série, ações simultâneas, série com buracos de cobertura.

## Comments

### O que foi entregue

Dois arquivos, um commit (`b8a7014` + fixes do code-review):

- **`lib/meta-tracking/correlation.ts`** — o núcleo puro (costura 3). Sem I/O, sem
  import de `lib/db` a não ser dos *tipos* do schema.
  - `selectVersionAt(versions, at, timeZone?)` — vigência meio-aberta
    `[valid_from, valid_to)`. Aceita instante **ou** dia `YYYY-MM-DD`; um dia
    devolve a configuração com que o dia **terminou** (é ela que responde pela
    linha da série daquele dia, e é por isso que o dia da mudança pertence à
    versão nova). `null` antes da primeira versão e depois de uma última versão
    já fechada.
  - `computeActionEffect({ action, series, windowDays, concurrentActions?, learningObservations?, timeZone? })`
    — as janelas e todas as flags.
  - `buildEntityTimeline({ versions, actions, series, range?, timeZone? })` —
    sequência cronológica única; no mesmo dia a ordem é versão → ação → métrica.
  - Utilitários exportados: `dayKeyOf`, `shiftDayKey`, `isDayKey`,
    `isSupportedTimeZone`, `assertWindowDays`.
- **`lib/db/meta-tracking-correlation-queries.ts`** — invólucros finos, no padrão
  `lib/db/*-queries.ts` da casa: `getEntityStateAt`, `getEntityTimeline`,
  `getActionEffect`, `findActions`. Carregam linhas e delegam; **nenhuma regra de
  correlação é reescrita em SQL**.
- **`lib/meta-tracking/correlation.test.ts`** — 31 testes, só do núcleo puro
  (`bun:test`, colocado, sem banco).

### Decisões de desenho que os próximos tickets herdam

1. **O dia da ação fica FORA das duas janelas.** A mudança acontece no meio do
   dia, então aquele dia mistura as duas configurações; incluí-lo de um lado
   contamina a comparação. Ele volta separado em `actionDayMetrics`.
2. **Buraco de cobertura encurta a janela, nunca a estica.** A janela é de
   calendário (`[D−N, D−1]` e `[D+1, D+N]`); dias ausentes simplesmente não
   entram, e `daysRequested` × `daysWithData` denuncia o buraco. Esticar para
   "completar N dias" compararia períodos diferentes sem avisar.
3. **Somas só são comparáveis quando `daysWithData` bate.** Para o caso geral
   existe `deltaPerDay` (depois − antes, normalizado por dia). Um lado sem
   nenhum dia com dado ⇒ `hasBothSides = false` e `deltaPerDay = null`.
4. **`reach` e `frequency` NÃO são agregados** — são métricas de pessoas únicas;
   somá-las por dia produz número sem significado. Quem precisar delas tem de
   pedir a janela inteira à Meta numa chamada só.
5. **Compras usam prioridade, não soma:** a Meta devolve `purchase` e
   `omni_purchase` para o mesmo fato, e somar dobra. Mesma lista de
   `lib/meta-business/transformers.ts`. Sem `action_values`, o valor cai para
   `purchase_roas × spend` (mesmo fallback do `insightsToWindowMetrics`).
6. **`provisional`** propaga `is_final = false`: janela com dia dentro dos 28 d
   de atribuição ainda pode mudar de valor. Serve à user story 12 da spec.
7. **Reset de fase de aprendizado tem dois sinais**, ambos dentro da janela:
   `last_sig_edit_ts` (carimbo da própria Meta, preciso) e transição de estado
   para `LEARNING*` vinda de uma leitura anterior fora do aprendizado. Entidade
   que **nasce** aprendendo não é reset — é estreia. Além do reset existe
   `learningPhaseActiveInWindow` (aprendizado ativo, com ou sem reset), porque
   uma janela inteira sob aprendizado também não é resultado limpo.
   ⚠️ `learning_stage_info` é campo **volátil** (fora do hash): só há observação
   nas versões que nasceram por outro motivo. A série é esparsa por natureza —
   ausência de sinal é "não há evidência", nunca "não houve reset". Se o ticket
   03/04 passar a atualizar os voláteis da versão vigente a cada coleta, este
   detector fica melhor de graça.
8. **Escopo de confundidor padrão é a campanha** (`concurrentScope: "campaign"`):
   mexer no orçamento da campanha ou pausar o conjunto irmão muda o resultado do
   anúncio tanto quanto mexer nele. `"entity"` restringe à própria entidade.
   O núcleo puro só filtra pela janela — quem decide o escopo é o invólucro.
9. **Dia é o da timezone da conta de anúncio.** `getActionEffect` resolve a
   timezone pela cobertura mais recente da conta
   (`meta_tracking_account_coverage.timezone_name`), com fallback UTC — inclusive
   se o valor gravado não for uma timezone reconhecida. **Ticket 03 precisa
   gravar `timezone_name` na cobertura**, senão toda correlação passa a raciocinar
   em UTC e os dias saem deslocados em relação ao Gerenciador.

### Índice desejado (migration proibida neste ticket)

`findActions` filtra por campo alterado com
`jsonb_exists_any(changed_fields, ARRAY[...]::text[])` — a forma funcional do
operador `?|`, escolhida em vez do `?` literal porque `?` é ambíguo para drivers
que o usam como placeholder. Isso é **sequential scan** sem índice.

**Para a migration consolidada futura** (junto com o item 2 do ticket 01):

```sql
CREATE INDEX IF NOT EXISTS meta_tracking_change_events_changed_fields_gin
  ON meta_tracking_change_events USING gin (changed_fields jsonb_path_ops);
```

`jsonb_path_ops` basta: só existe consulta por existência de chave; o operador
`?|` é suportado por `gin (jsonb_ops)` — se a busca evoluir para `?|` puro no
planner, trocar para o opclass default. Enquanto não houver índice, os outros
filtros (`account_id`/`occurred_at`, `entity`, `source`) é que seguram a consulta —
por isso `findActions` tem `limit` com teto de 500.

### Verificação (o que foi e o que NÃO foi executado)

- `bun test lib/meta-tracking/correlation.test.ts` → **31/31 passam**.
- `bunx tsc --noEmit` → **5 erros, exatamente os pré-existentes**
  (`lib/env/frontend-app-url.test.ts` ×3, `lib/backoffice/users-csv.test.ts`,
  `lib/backoffice/portfolio-filters.test.ts`). Zero erros novos.
- `bunx eslint` nos três arquivos → limpo.
- `bun test` completo: **nenhuma falha vem deste ticket**. A suíte do backoffice
  continua não-determinística pelo motivo já documentado no ticket 01 — as suítes
  de afiliados exigem Postgres em `localhost:5432` (Docker ausente) e, ao falharem
  no import, disparam em cascata o `describe() inside another test()` do bun nas
  suítes `node:test` colocadas. Prova: `lib/products/finance.test.ts` passa
  sozinho (4/4) e "falha" dentro da execução completa.
- **NADA foi executado contra Postgres nem contra a Graph API.** O SQL do
  `findActions` foi conferido renderizando a query com `QueryBuilder` do
  `drizzle-orm/pg-core` (sem cliente, sem conexão) em script descartável:
  `... where (account_id = $1 and jsonb_exists_any("changed_fields", ARRAY[$2, $3]::text[]) and source in ($4,$5) ...)`.
  Os nomes de campo entram como **parâmetro**, não interpolados.

### Avisos para os próximos tickets

1. **Ticket 09 (tela de operação)** consome este módulo direto: `findActions`
   para o histórico unificado por campanha/conjunto (filtra por `entityLevel` +
   `entityId` ou `campaignId`), `getEntityTimeline` para a história completa e
   `getActionEffect` para o "antes/depois" de uma ação. `getEntityTimeline`
   devolve `{ stateAtStart, entries }` — `stateAtStart` é a configuração que já
   valia quando o período começou (não é entrada da linha do tempo).
2. **`getActionEffect` roda 4 consultas** (evento, série, concorrentes, versões).
   Chamá-lo em laço para uma lista de ações é N×4 — se a tela precisar disso, o
   caminho é uma variante em lote, não o laço.
3. **`findActions` tem teto de 500** e ordena por `occurred_at desc, id desc`
   (o id desempata para a paginação não repetir nem pular ações simultâneas).
4. **Não existe teste dos invólucros de banco** — proposital: eles são finos e
   testá-los exigiria banco. Toda a regra testável está no núcleo puro. Se um
   invólucro ganhar decisão própria, ela deve nascer no núcleo, não lá.
5. **Dinheiro:** este módulo só soma valores de *insights* (`spend`,
   `action_values`), que vêm em unidades **maiores**. Os orçamentos das versões
   (`daily_budget` etc.) vêm em unidades **menores** — nunca some os dois sem
   converter. O aviso 6 do ticket 01 continua valendo.

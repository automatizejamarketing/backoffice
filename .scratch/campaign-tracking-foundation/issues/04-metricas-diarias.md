# 04 — Série diária de métricas (janela móvel de 28 dias)

**What to build:** O passo de resultados no pipeline do coletor: para cada conta coberta, insights nos três níveis (campanha, conjunto, anúncio) com incremento diário e atribuição unificada, upsert de uma linha por entidade×dia na janela móvel dos últimos 28 dias. Dias que saem da janela são marcados como finais (insights congelam após 28 dias, conforme documentação oficial). Erro de volume de linhas degrada para fatias menores de período. A persistência é sempre por dia — nenhuma janela agregada é armazenada.

**Blocked by:** 03 — Coletor diário.

**Status:** resolved

- [x] Após a coleta, cada entidade com entrega tem uma linha por dia dos últimos 28 dias, com numéricos universais tipados e famílias de ações/valores/custos em JSON.
- [x] Re-execução atualiza os dias existentes (atribuição retroativa) sem duplicar linhas.
- [x] Dias além da janela de mutabilidade ficam marcados como finais e não são re-escritos.
- [x] Entidades recém-pausadas continuam recebendo os dias finais da cauda de atribuição (coleta por conta, não por entidade).
- [x] Erro de volume da Meta (fatia grande demais) reduz o período automaticamente e completa a conta. *(o recuo é por bisseção do período, não por semana fixa — ver Comments; o último recurso do §5.6, o job assíncrono, **não** entrou: fica no ticket 05.)*
- [x] Contadores de linhas upsertadas aparecem no summary do run e na cobertura. *(reinterpretado por proibição de migration: `metricRowsUpserted` e `metricSlicesDegraded` entram no `summary` do run, no retorno da rota de cron e na saída do script — **por conta** via `onProgress`. A tabela de cobertura **não** ganhou coluna: `meta_tracking_account_coverage` não tem `metric_rows_upserted` e criar migration está vedado. O que já aparece na cobertura hoje é `api_calls_used`, que passou a incluir as chamadas de insights. Coluna desejada anotada abaixo.)*

## Comments

### O que foi entregue

Quatro arquivos novos no backoffice e seis tocados. Nada fora disso.

**A decisão (pura, testada pesado):**

- **`lib/meta-tracking/daily-metrics.ts`** — "o que é um dia de métrica":
  `metricsWindowFor` (a janela móvel), `isFinalMetricDay` (quando o dia
  congela), `toDailyMetricRows` (a resposta de insights vira linhas),
  `splitInsightsRange`/`rangeDays` (o recuo por volume) e
  `isInsightsRowLimitError`.

**O passo (fino, injetável):**

- **`lib/meta-tracking/collect-daily-metrics.ts`** — `collectDailyMetrics(ports, args)`.
  Percorre os três níveis do pai para o filho, grava a cada nível, encolhe o
  período quando a Meta reclama do volume e para antes de estourar a cota.
  Não sabe falar HTTP nem SQL: é isso que permite exercitar a degradação
  — o comportamento mais difícil de observar em produção — com portas falsas.

**Os executores (finos, sem teste unitário, por decisão de coleta):**

- **`fetchAccountInsights`** em `lib/meta-tracking/graph-collector-gateway.ts` —
  `level=…`, `time_increment=1`, `time_range`, `use_unified_attribution_setting=true`,
  paginado, com leitura de cota nos headers e recuo de field set.
- **`lib/db/meta-tracking-metrics-queries.ts`** — `upsertDailyMetricRows`,
  `INSERT … ON CONFLICT (entity_level, entity_id, metric_date) DO UPDATE`
  em lotes de 400, com `setWhere` que **recusa reescrever dia já final**.

**A ligação:** porta `collectDailyMetrics` em `DailyCollectionPorts`, chamada em
`collectAccount` **depois** da persistência da configuração, composta em
`daily-collection-ports.ts`. Contadores no summary do run, na rota de cron e no
script.

**31 testes novos** (`daily-metrics` 21, `collect-daily-metrics` 8, mais 6 no
`run-daily-collection`), `bun:test`, zero banco e zero rede.

### As três decisões que valem revisão

1. **A janela é `[hoje−28, hoje]` — 29 dias de calendário — e o dia da borda
   nasce `is_final`.** As duas regras são uma só de propósito: um dia sai da
   janela no mesmo instante em que passa a ser imutável. Se a janela fosse
   `[hoje−27, hoje]` (28 dias "redondos"), o dia `hoje−28` seria mutável e não
   re-coletado; se `is_final` fosse `metric_date < hoje−28`, o dia da borda
   sairia da janela **sem nunca ter sido marcado**, e ficaria mutável para
   sempre.
2. **O recuo por volume é bisseção, não "chunk por semana" (§5.6 do plano).**
   Partir ao meio chega em fatias de ~7 dias em dois passos e se adapta à conta:
   quem estoura por pouco faz 1 fatia extra, quem estoura muito continua
   descendo até o dia único. As metades cobrem o período sem sobrepor, então a
   série sai idêntica.
   **O último recurso do §5.6 — o job assíncrono de insights — NÃO foi
   implementado.** Aqui, nível que estoura o teto até num dia único é
   **abandonado no dia**, com o erro no run (a cobertura segue `complete`:
   reinsistir multiplicaria por nove, na madrugada, um erro que a própria Meta
   devolveu — e a licença é throttled por taxa de erro). Ver aviso 4.
3. **Falha nas métricas marca a conta `failed`, e isso é seguro.** As métricas
   rodam **depois** da persistência da configuração, então a configuração do dia
   — que não existe em lugar nenhum para ser buscada depois — já está salva. E a
   série se recupera sozinha: a janela móvel re-coleta os mesmos dias amanhã.
   Perder um dia de coleta de métricas não perde métrica nenhuma.

### Avisos para os próximos tickets

1. **Unidades.** `spend` e `action_values` dos insights vêm em unidades
   **MAIORES** da moeda da conta (`"128.47"` = R$ 128,47); os orçamentos das
   versões vêm em unidades **menores** (`"5000"` = R$ 50,00). As duas escalas
   convivem no mesmo banco. A gravação é crua, sem conversão — quem somar ou
   comparar gasto com orçamento converte no ponto de consumo, com a moeda da
   conta (`meta_tracking_account_coverage.currency`) em mãos. Está documentado no
   cabeçalho de `daily-metrics.ts` e no de `correlation.ts`.
2. **Colunas/índices desejados, nenhuma migration criada** (`db:generate` segue
   quebrado — ticket 01). Para a migration consolidada futura:
   `meta_tracking_account_coverage.metric_rows_upserted integer NOT NULL DEFAULT 0`
   (o critério 6 pede o contador na cobertura; hoje ele só existe agregado no
   `summary` do run e por conta em memória). Enquanto não existir, o contador por
   conta×dia é **derivável**: `count(*) FROM meta_tracking_daily_metrics WHERE
   account_id = ? AND last_refreshed_at::date = ?`. Continuam pendentes os já
   anotados: GIN em `changed_fields` e UNIQUE parcial de versão aberta.
3. **`is_final` é o guarda-corpo do backfill (ticket 05).** O upsert diário tem
   `setWhere: is_final = false`: linha já congelada **não** é reescrita. O
   backfill pode gravar 13 meses com `is_final = true` sem medo de a coleta
   diária regredir os valores — e sem precisar coordenar ordem de execução. A
   recíproca também vale: o backfill não deve marcar `is_final` em dia que ainda
   está dentro da janela de 28 dias, senão trava a atribuição retroativa.
4. **O passo é reaproveitável pelo backfill (ticket 05), mas hoje só sabe a
   janela de 28 dias.** `CollectDailyMetricsArgs` não tem `range` — foi removido
   de propósito por ser generalidade especulativa sem teste. O ticket 05 adiciona
   o parâmetro com o teste dele, e ganha de graça `toDailyMetricRows`,
   `splitInsightsRange` e o `upsertDailyMetricRows`. O job assíncrono
   (`POST /act_…/insights` + `report_run_id`) que o 05 vai construir é também o
   último recurso que falta no recuo por volume desta coleta: quando existir,
   `levelsAbandoned` vira "manda para o job assíncrono".
5. **`toDailyMetricRows` colapsa `(entidade, dia)` repetido na última
   ocorrência.** Não é preciosismo: `INSERT … ON CONFLICT DO UPDATE` com a mesma
   chave duas vezes no mesmo comando é **erro** do Postgres, e o fatiamento por
   volume é justamente o que pode trazer o mesmo dia duas vezes.
6. **A série vem da CONTA, nunca da lista de entidades ativas.** É isso que
   entrega a cauda de atribuição de quem foi pausado ontem (critério 4) — e é
   por isso que a porta `fetchInsights` não tem parâmetro de entidade nenhum.
   Quem for otimizar chamadas: filtrar por entidade aqui quebraria o critério.
7. **`campaign_id` é nulo em linha de nível campanha, `adset_id` só existe em
   linha de anúncio** — mesma convenção de `meta_tracking_config_versions`
   (`projectVersionColumns`). Quem consultar "tudo abaixo da campanha X" por
   `campaign_id` **não** pega a linha da própria campanha; para ela é
   `(entity_level = 'campaign', entity_id = X)`. **Ticket 08/09.**
8. **`cost_per_result` é o único campo do field set com recuo.** Se a Meta
   rejeitar o `fields` com erro 100 (que **não** seja o subcódigo de volume,
   1487534), o gateway repete uma vez sem ele. A ordem das duas guardas importa:
   volume e campo inválido chegam os dois como erro 100, e inverter faria o
   fatiamento nunca acontecer.
9. **Contador novo no summary: `metricSlicesDegraded`.** Diferente de zero =
   alguma conta está encostando no teto de linhas da Meta. Vale destaque na tela
   de operação (**ticket 09**) junto com `skipped_reconnect` — é o aviso
   antecipado de que o nível de anúncio daquela conta vai começar a falhar.

### Runbook da primeira execução real (para o humano)

Nada disto foi rodado: o `.env.local` do backoffice aponta para **produção** e a
migration `0044` ainda não foi aplicada em banco nenhum (ticket 01). Continua
valendo o runbook do ticket 03; a série diária acrescenta:

1. Depois da primeira coleta de um cliente
   (`APP_ENV=<alvo> bun scripts/with-env.ts bun scripts/collect-meta-tracking.ts --user=<uuid> --max=1`),
   conferir `meta_tracking_daily_metrics`: ~29 linhas por entidade **com
   entrega** em cada nível, `metric_date` na timezone da conta, `is_final = true`
   só no dia mais antigo.
2. Comparar `spend` de um dia com o Gerenciador de Anúncios do cliente **no
   mesmo dia e na mesma conta**: têm de bater, porque a coleta pede
   `use_unified_attribution_setting=true`. Se não baterem, é o primeiro lugar a
   olhar.
3. Rodar o mesmo comando de novo com `--all`: `metricRowsUpserted` deve repetir
   as linhas mutáveis (upsert, sem duplicar) e **não** deve tocar no dia final.
4. Olhar `metricSlicesDegraded` no resumo: acima de zero, a conta já está
   encostando no teto de linhas da Meta.

### Verificação (ambiente)

Nenhum comando tocou Postgres real nem a Graph API — a decisão é pura e o passo
foi testado com portas falsas.

- `bun test lib/meta-tracking/` → **175/175** (31 novos).
- `bun test lib/` (todas as suítes colocadas) → **463/463**.
- `bunx tsc --noEmit` → o **mesmo baseline pré-existente** de 11 linhas
  (`portfolio-filters.test.ts`, `users-csv.test.ts` importando `vitest`,
  `frontend-app-url.test.ts`); zero erro nos arquivos deste ticket.
- `bunx eslint` nos arquivos tocados → limpo.
- `bun test` completo → continua **não determinístico** (462–538 testes entre
  execuções, pela cascata de `describe() inside another test()` do bun) e todas
  as falhas são as suítes de integração do Programa de Afiliados, que exigem um
  Postgres descartável em `localhost:55432` via Docker (ausente nesta máquina).
  **Nenhuma falha em `meta-tracking`, nenhuma falha nova.**

### Code review

Rodado ao final nos dois eixos. Sem ferramenta de sub-agente disponível nesta
sessão, os dois eixos foram percorridos manualmente sobre o diff. Quatro achados
reais, corrigidos antes do commit:

1. **Generalidade especulativa** — `mutableDays` opcional em três funções e
   `range` opcional em `CollectDailyMetricsArgs`, nenhum com chamador nem teste.
   Removidos (o `range` volta no ticket 05, com o teste dele).
2. **`slicesDegraded` era saída morta** — calculado e nunca consumido. Virou
   `metricSlicesDegraded` no summary do run, na rota de cron e no script, com
   asserção.
3. **`const window`** sombreava o global do DOM dentro de um módulo que um
   client component poderia importar. Renomeado.
4. **Critério 4 sem teste que o fixasse** — a coleta por conta era propriedade
   estrutural implícita. Ganhou teste nomeado ("a série vem da CONTA…").

Mantidos conscientemente: os coercitivos `text`/`count`/`decimal`/`jsonOrNull`
de `daily-metrics.ts` **parecem** os de `config-version.ts` mas têm semântica
diferente de propósito (contagem chega como string nos insights; família que vem
escalar é resposta corrompida) — há comentário no arquivo avisando para não
unificar; e o acumulador mutável de `fetchLevel`, mesmo padrão de
`runPerformanceDropBatch` e do orquestrador do ticket 03.

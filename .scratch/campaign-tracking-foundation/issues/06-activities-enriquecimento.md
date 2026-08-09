# 06 — Audit trail da Meta: poll cru + enriquecimento de ações

**What to build:** O poll diário do audit trail oficial da conta (`activities`) com janela de sobreposição de 48h, persistindo todos os eventos crus deduplicados — inclusive os sem relação com ações (billing, públicos, papéis), que ficam como matéria-prima futura. Um matcher liga os eventos às ações detectadas pelo diff (mesma entidade, janela temporal) e preenche autor e horário exato na ação. O detalhe interno (`extra_data`) e a retenção do endpoint não são documentados pela Meta: o enriquecimento é oportunista e sua falha nunca afeta a detecção via diff.

**Blocked by:** 03 — Coletor diário.

**Status:** resolved

- [x] Mudança feita direto no Gerenciador de Anúncios aparece no stream com autor e horário exato após a coleta seguinte. *(reinterpretado por segurança de ambiente: o passo existe e está composto no coletor; o comportamento é coberto por teste com portas falsas — **nenhum comando tocou Postgres real nem a Graph API**. Execução real no runbook abaixo.)*
- [x] Poll de dois dias consecutivos não duplica eventos (dedup por chave composta na sobreposição).
- [x] Evento sem match permanece persistido cru, marcado como não-ligado.
- [x] Falha do endpoint de activities não derruba a cobertura da conta — a coleta segue e o enriquecimento fica pendente.
- [x] Matcher é parte pura da costura do delta, testado com fixtures (match certo, ambíguo e sem candidato). *(o matcher é puro e testado por fixture, mas mora **ao lado** de `computeTrackingDelta`, não dentro — ver "O desvio consciente" abaixo.)*

## Comments

### O que foi entregue

Três arquivos novos no backoffice e seis tocados. Nada fora disso.

**A decisão (pura, testada pesado):**

- **`lib/meta-tracking/activity-enrichment.ts`** — "o que é um evento de audit
  trail e qual ação ele explica": `activityDedupHash` (o contrato do schema),
  `toActivityEventRows` (a resposta vira linhas) e `matchActivitiesToChanges`
  (o matcher), mais `ACTIVITY_POLL_OVERLAP_MS`.

**O passo (fino, injetável):**

- **`lib/meta-tracking/collect-activity-events.ts`** — `collectActivityEvents(ports, args)`.
  Busca a janela, grava tudo, descobre quais ações ainda não têm autor e liga as
  duas coisas. Não sabe falar HTTP nem SQL: é o que permite exercitar a
  sobreposição de 48 h e a deduplicação sem banco e sem rede.

**Os executores (finos, sem teste unitário, por decisão de coleta):**

- **`fetchAccountActivities`** em `lib/meta-tracking/graph-collector-gateway.ts` —
  `since`/`until` em epoch, paginado, com leitura de cota e **recuo sem
  `extra_data`**.
- **`lib/db/meta-tracking-activity-queries.ts`** — `upsertActivityEvents`
  (`ON CONFLICT (dedup_hash) DO UPDATE SET fetched_at`, devolvendo o uuid de
  cada linha), `loadEnrichableChangeEvents` e `linkActivityMatches` (os dois
  lados da ponte, numa transação).

**A ligação:** porta `collectActivityEvents` em `DailyCollectionPorts`, chamada em
`collectAccount` **depois** da persistência do delta e **antes** das métricas,
dentro de um `try/catch` próprio. Contadores `activityEventsUpserted` /
`activityEventsMatched` no summary do run, na rota de cron e no script.

**39 testes novos** (`activity-enrichment` 20, `collect-activity-events` 9, mais
3 novos e 2 ajustados em `run-daily-collection`), `bun:test`, zero banco e zero
rede.

### O desvio consciente: o matcher fica AO LADO da costura do delta

O critério 5 pede o matcher "parte pura da costura do delta". Ele é **puro** e
**testado com fixtures**, como pedido, mas é um módulo próprio em vez de uma
saída de `computeTrackingDelta` — e não por conveniência:

1. O match precisa do **uuid** das ações, que só existe depois do INSERT. A
   costura do delta trabalha com `ref`s locais justamente porque nada dela foi
   gravado ainda.
2. O match também alcança ações de **execuções anteriores** (é assim que "o
   enriquecimento fica pendente" do critério 4 vira "e é resolvido amanhã"), e
   essas ações não estão no delta de hoje.

Empurrar as duas coisas para dentro de `computeTrackingDelta` obrigaria a costura
a conhecer a ordem de persistência — exatamente o que ela evita. O precedente já
existe: o passo de métricas (ticket 04) também é um módulo puro ao lado, não
dentro.

### As três decisões que valem revisão

1. **Ambiguidade não vira palpite.** Dois eventos de **atores diferentes** na
   mesma entidade, mesma natureza e mesma janela ⇒ **nenhum** match: a ação fica
   sem autor e os dois eventos crus ficam guardados. Um autor errado no
   histórico é pior do que nenhum, porque ninguém tem como saber depois que ele
   está errado. Dois eventos do **mesmo** ator não são ambiguidade: vale o mais
   recente, que é o que produziu o estado observado.
2. **O `event_type` classifica a natureza do evento** (ciclo de vida × criação ×
   configuração) e o candidato precisa bater com o `change_kind` da ação. Sem
   isso, quem pausou a campanha às 20h levaria o crédito de quem mexeu no
   orçamento dela às 17h — os dois fatos existem como eventos separados nos dois
   lados. A regra usa só o que a Meta **documenta** (`run_status` no nome, prefixo
   `create_`); o desconhecido cai em "configuração", que é a natureza que não
   afirma nada sobre ciclo de vida.
3. **Um evento cru explica uma ação só — inclusive entre execuções.** Dentro de
   um match o evento é consumido; entre dias, `upsertActivityEvents` devolve
   `matched_change_event_id` e quem já explicou algo é filtrado antes do matcher.
   Sem isso a sobreposição de 48 h faria o mesmo evento ser a causa declarada de
   dois fatos distintos, sem jeito de saber qual mente.

### Avisos para os próximos tickets

1. **O enriquecimento reescreve `occurred_at`.** A ação nasce com
   `occurred_at = detected_at` (o instante da coleta) e passa a ter o
   `event_time` do audit trail quando casa. Quem ordenar o stream por
   `occurred_at` verá as ações enriquecidas "andarem para trás" até 48 h — é o
   ponto, não bug. A ordem relativa entre transições da mesma entidade se
   mantém (o evento enriquecido de hoje é sempre posterior à detecção de ontem).
   **Tickets 08/09.**
2. **Só `source = 'external_detected'` entra na fila do enriquecimento.** Ação
   registrada pela plataforma (backoffice/painel) já tem autor e horário exatos;
   trocá-los pelo que a Meta atribuiu seria trocar o certo pelo aproximado. Como
   consequência, o evento cru correspondente a uma escrita interna fica
   **sem match para sempre** — persistido cru, que é o comportamento correto.
3. **`actor_name_meta` pode ser NULL mesmo com match.** A Meta nem sempre
   preenche `actor_name` (eventos de sistema, por exemplo). Match sem nome ainda
   entrega o **horário exato**, que é metade do valor. Quem for exibir precisa
   tratar o nulo. **Ticket 09.**
4. **A janela do matcher é a mesma do poll (48 h), e isso é um limite real.**
   Ação pendente há mais de 48 h já não tem como ser explicada: o evento que a
   explicaria não vem mais na resposta. Ela fica anônima para sempre — e é assim
   que o design "degrada bem" que a spec pede. Aumentar a janela do matcher sem
   aumentar a do poll não resolveria nada.
5. **`event_type` é `varchar(64)` e `object_type` é `varchar(48)` no schema, e
   não há truncamento no código.** Um valor mais longo do que isso faria o INSERT
   explodir — e, por causa do `try/catch` do passo, isso apareceria como "audit
   trail indisponível" no run, com a cobertura intacta. Se alguém vir esse erro
   repetido em produção, é o primeiro lugar a olhar.
6. **Índices ainda desejados** (nenhuma migration criada — `db:generate` segue
   quebrado, ticket 01): além do GIN em `changed_fields`, do UNIQUE parcial de
   versão aberta e da coluna `metric_rows_upserted` na cobertura já anotados,
   este ticket consulta `meta_tracking_change_events` por `(account_id, source)`
   filtrando `activity_event_id IS NULL` e `detected_at >= …` — o índice
   `(account_id, occurred_at)` existente **não** atende bem (o filtro é por
   `detected_at`); um parcial
   `(account_id, detected_at) WHERE activity_event_id IS NULL` seria o ideal.
7. **`extra_data` chega como STRING de JSON**, não como objeto, e é gravado
   aberto (`JSON.parse`) quando dá — texto cru quando não dá. **Nenhuma lógica
   depende do formato**, e nenhuma deve passar a depender: é o único campo não
   documentado da resposta.

### Runbook da primeira execução real (para o humano)

Nada disto foi rodado: o `.env.local` do backoffice aponta para **produção** e a
migration `0044` ainda não foi aplicada em banco nenhum (ticket 01). Continuam
valendo os runbooks dos tickets 03 e 04; o audit trail acrescenta:

1. Depois da coleta de um cliente
   (`APP_ENV=<alvo> bun scripts/with-env.ts bun scripts/collect-meta-tracking.ts --user=<uuid> --max=1`),
   conferir `activityEventsUpserted` no resumo: acima de zero significa que o
   endpoint respondeu. Zero **não** é erro — conta parada em 48 h não tem
   atividade.
2. `SELECT event_type, actor_name, object_type, matched_change_event_id FROM
   meta_tracking_activity_events WHERE account_id = ? ORDER BY event_time DESC`:
   devem aparecer eventos de todos os tipos, inclusive os sem `object_id`.
3. Pedir ao cliente para mexer em algo pelo Gerenciador de Anúncios e rodar a
   coleta no dia seguinte: a ação deve aparecer em `meta_tracking_change_events`
   com `actor_name_meta` preenchido, `occurred_at` igual ao horário do
   Gerenciador e `activity_event_id` apontando para o evento cru — e o evento
   cru com `matched_change_event_id` de volta.
4. Rodar o mesmo comando de novo com `--all`: `activityEventsUpserted` repete
   (a sobreposição), mas `SELECT count(*) FROM meta_tracking_activity_events`
   **não** pode crescer, e `activityEventsMatched` deve cair para zero.
5. Se a Meta rejeitar o field set, o log traz
   `field set de activities rejeitado; recuando sem extra_data` — a coleta
   continua, só sem o detalhe opaco.

### Verificação (ambiente)

Nenhum comando tocou Postgres real nem a Graph API — a decisão é pura e o passo
foi testado com portas falsas.

- `bun test lib/meta-tracking/` → **286/286** (39 novos; o total inclui os
  tickets 04/05/09 que rodavam em paralelo).
- `bunx tsc --noEmit` → o **mesmo baseline pré-existente**
  (`portfolio-filters.test.ts`, `users-csv.test.ts` importando `vitest`,
  `frontend-app-url.test.ts`); zero erro nos arquivos deste ticket.
- `bunx eslint` nos arquivos tocados → limpo.
- `bun test` completo → 550 testes, 42 falhas, **todas** das suítes de
  integração do Programa de Afiliados, que exigem um Postgres descartável em
  `localhost:55432` via Docker (ausente nesta máquina), mais a cascata de
  `describe() inside another test()` do bun. Baseline pré-existente, **nenhuma
  falha em `meta-tracking`, nenhuma falha nova**.

### Code review

Rodado ao final nos dois eixos (padrões e spec). Sem ferramenta de sub-agente
disponível nesta sessão, os dois eixos foram percorridos manualmente sobre
`git diff HEAD~1...HEAD`. Três achados reais, corrigidos em commit próprio:

1. **Generalidade especulativa** — `toleranceMs?` opcional em
   `MatchActivitiesInput`, sem chamador e sem teste (o mesmo achado que o ticket
   04 levou). Removido: a janela é `ACTIVITY_POLL_OVERLAP_MS`, e ela não pode
   divergir da do poll.
2. **Cerimônia inútil** — `mergeQuotaUsage(UNKNOWN_QUOTA_USAGE, fetched.usage)`
   é literalmente `fetched.usage`. Simplificado, com dois imports a menos.
3. **Ramo morto** — o `if (!activityEventId) continue;` era inalcançável (o
   match só sai de `available`, e `available` é exatamente o conteúdo do mapa).
   Virou `.map()` com a razão no comentário.

Mantidos conscientemente: o coercitivo `text()` duplicado de `daily-metrics.ts`
(o repo já decidiu, no code review do ticket 04, não unificar os coercitivos dos
módulos puros — eles respondem a perguntas diferentes e mudam por motivos
diferentes); e o recuo de field set do gateway, que não foi pedido pelo ticket
mas é o padrão já estabelecido pelos outros dois executores e é exatamente o
seguro contra o único campo não documentado da resposta.

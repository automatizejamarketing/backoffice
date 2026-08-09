# 11 — Snapshot do conteúdo do criativo (URL de promoção incluída)

**What to build:** O passo do coletor que ficou entre as fronteiras dos tickets 03 e 06: quando uma versão de configuração de anúncio referencia um `creative_id` que ainda não existe em `meta_tracking_creatives` (tabela já criada no ticket 01, hoje vazia), o coletor busca o conteúdo do criativo uma única vez e grava — criativos são imutáveis na Meta, então é uma foto única, sem versionamento. O conteúdo inclui o que responde "o que este anúncio mostrava e para onde levava": `object_story_spec` (onde mora a URL de destino/promoção, o texto e o CTA), `asset_feed_spec` (variações do Advantage+), `url_tags` (UTMs), `call_to_action_type`, `effective_object_story_id`, `name`, `status` e referências de mídia. Isso fecha a correlação "troca de criativo → resultado" com o conteúdo do criativo em mãos, incluindo a URL de promoção.

**Blocked by:** None — can start immediately (constrói sobre os tickets 02/03/04 já concluídos).

**Status:** resolved

- [x] Coleta diária e baseline/backfill detectam `creative_id` desconhecido e buscam o criativo em lote (chunks no padrão do gateway existente), com recuo de field set em erro 100 (padrão já estabelecido) e respeito à cota pelos headers. *(reinterpretado: a detecção é uma **varredura por conta**, não um subproduto do delta — por isso ela vale para os dois caminhos sem que `run-backfill.ts` precise mudar. O passo NÃO foi pendurado no orquestrador do backfill; ver "A decisão que vale revisão" nº 2.)*
- [x] Criativo já presente na tabela nunca é rebuscado (foto única); o upsert é idempotente por id.
- [x] Falha na busca de criativos não derruba a cobertura da conta — erro registrado no run, contador de pendentes, e a próxima coleta tenta de novo os que faltaram.
- [x] A URL de promoção fica consultável no jsonb do criativo quando a Meta a retorna (`object_story_spec.link_data.link` e equivalentes de vídeo/asset_feed).
- [x] Contadores novos (`creativesFetched`, `creativesFailed` ou equivalentes) entram no summary do run, na rota de cron, no script e em `COUNTER_KEYS` da tela de operação com rótulo pt-BR (contrato do ticket 09 — contador fora da lista não aparece). *(`creativesFetched` + `creativesPending`; "pendentes" em vez de "falhados" porque é o que o critério 3 pede e o que o operador precisa ver.)*
- [x] Sem migration: a tabela existe. Comportamento coberto por testes puros (decisão de quem buscar, transformação da resposta em linha, tolerância a falha); nenhuma chamada real a Postgres ou à Meta API nos testes.

## Comments

### O que foi entregue

Três arquivos novos no backoffice (mais dois de teste) e sete tocados.

**A decisão (pura, testada):**

- **`lib/meta-tracking/creative-snapshot.ts`** — "o que é um snapshot de criativo":
  `planCreativeFetch` (quem buscar agora, deduplicado, em lotes de 50, com teto
  por execução), `toCreativeSnapshotRow` (a resposta vira linha) e
  `promotionUrlsOf` (para onde o criativo levava). 11 testes.

**O passo (fino, injetável):**

- **`lib/meta-tracking/collect-creative-snapshots.ts`** —
  `collectCreativeSnapshots(ports, args)`. Três portas: descobrir os
  desconhecidos, buscar o lote, gravar. Sabe do teto por execução, da parada por
  cota entre lotes e de não deixar uma recusa da Meta custar a cobertura do dia.
  9 testes com portas falsas.

**Os executores (finos, sem teste unitário, por decisão de coleta):**

- **`fetchAdCreatives`** em `graph-collector-gateway.ts` — node batch de 50,
  field set do §4.6, recuo para o essencial em erro 100, leitura de cota nos
  headers.
- **`lib/db/meta-tracking-creative-queries.ts`** — `listUnknownCreativeIds`
  (anti-join `LEFT JOIN … IS NULL` entre `creative_id` das versões de anúncio da
  conta e a tabela de snapshots) e `insertCreativeSnapshots`
  (`ON CONFLICT (id) DO NOTHING`).

**A ligação:** porta `collectCreativeSnapshots` em `DailyCollectionPorts`,
chamada em `collectAccount` **por último**, composta em
`daily-collection-ports.ts`. Contadores `creativesFetched` / `creativesPending`
no summary do run, na rota de cron, no script, em `COUNTER_KEYS` e na tela
(pill "Criativos" + aviso de pendentes).

**24 testes novos** (`creative-snapshot` 11, `collect-creative-snapshots` 9,
`run-daily-collection` +4), `bun:test`, zero banco e zero rede.

### As decisões que valem revisão

1. **A detecção é uma VARREDURA por conta, não o delta do dia.** O ticket
   oferecia as duas; a varredura venceu por ser **auto-corretiva**. A pendência
   não precisa de estado em lugar nenhum — a ausência da linha em
   `meta_tracking_creatives` É a pendência —, e com isso ela pega de graça o
   passivo do baseline/backfill (que cria versões de TODAS as entidades, sem
   passar por delta diário nenhum) e o que falhou ontem. Pelo caminho do delta,
   um criativo que falhasse hoje só voltaria a ser tentado quando o anúncio
   mudasse de configuração — isto é, possivelmente nunca. A varredura olha
   **todas** as versões de anúncio, não só a vigente: o criativo de uma versão
   antiga é justamente o que responde "o que estava no ar antes da troca".
2. **O passo NÃO foi pendurado no orquestrador do backfill**, e isso é
   deliberado por dois motivos. O primeiro é de desenho: o backfill corre contra
   a janela deslizante de 37 meses da Meta, e gastar o orçamento de chamadas
   dele com criativos — a única coisa desta fundação que **não perece** —
   atrasaria justamente o que é irrecuperável. O segundo é de fato: como a
   detecção é por conta, os criativos que o baseline descobre são capturados
   pela primeira coleta diária daquela conta, sem perda nenhuma (criativo é
   imutável; um dia de atraso não muda o conteúdo). Se um dia se quiser o
   snapshot na mesma noite da ativação, são quatro linhas: uma porta em
   `BackfillPorts`, a chamada depois do `captureBaseline`, os contadores no
   `BackfillResult` e a composição em `backfill-ports.ts`. **Não foi feito agora
   também porque `run-backfill.ts` estava sendo editado em paralelo pelo ticket
   10** — mexer nele arriscaria commitar trabalho alheio pela metade.
3. **Criativos por ÚLTIMO no pipeline por conta** (§5 do plano os coloca em
   quarto, antes de activities e insights). A ordem aqui é por perecibilidade: a
   configuração do dia não existe em lugar nenhum para ser buscada depois, o
   audit trail tem janela de retenção, a série tem janela móvel — e o criativo é
   imutável. Quem não perece cede a vez quando a cota aperta. Consequência
   prática: conta que ficou `partial` por cota não gasta chamada com criativos, e
   a varredura de amanhã os encontra de novo.
4. **O teto é de 300 criativos por conta por execução** (6 node batches). Uma
   conta recém-ativada pode ter milhares; drená-los todos numa invocação
   roubaria a cota das etapas com prazo. Com ~9 disparos por madrugada isso dá
   2.700 criativos/conta/noite, e o excedente entra em `creativesPending`.
5. **Duas recusas da Meta encerram os criativos daquela conta no dia**
   (`MAX_CREATIVE_FETCH_FAILURES`), mesmo raciocínio do
   `MAX_SLICE_FAILURES_PER_ACCOUNT` do backfill: a licença do app é throttled por
   taxa de erro, e uma conta com problema sistemático geraria um erro por lote. O
   lote recusado **não** interrompe os seguintes — só conta uma falha.

### Avisos para os próximos tickets

1. **Um id irrecuperável segura o lote dele.** O node batch da Graph API falha
   inteiro quando um dos ids é inacessível. Se um `creative_id` gravado numa
   versão antiga deixar de ser legível, o lote de até 50 que o contém falha todo
   dia e os outros 49 nunca são capturados (a varredura é determinística: o mesmo
   lote se reforma amanhã). Não foi tratado porque o cenário é improvável —
   criativo não é apagado quando o anúncio é — e porque o executor irmão
   (`fetchTrackedConfigs`) tem a mesma exposição e a mesma postura. O remédio, se
   aparecer na operação, é bissecção do lote em caso de erro, exatamente como o
   `splitInsightsRange` faz com o período dos insights.
2. **`creativesPending` é um PISO, não o total.** `listUnknownCreativeIds` corta
   em 5.000 ids por varredura (válvula de memória); acima disso o contador
   reporta menos do que existe. Só importa em conta com histórico gigantesco, e
   o excedente aparece nas varreduras seguintes.
3. **`promotionUrlsOf` é a autoridade sobre onde mora a URL de destino**, e hoje
   ela não tem chamador de produção — é a forma executável do critério 4 e
   existe para que o primeiro consumidor não reinvente (e erre) a travessia. A
   URL muda de lugar conforme o tipo do anúncio: `link_data.link` no anúncio de
   link, só dentro de `call_to_action.value.link` no de vídeo, uma por cartão em
   `child_attachments` no carrossel, e uma LISTA em `asset_feed_spec.link_urls[]`
   no Advantage+. Post impulsionado não declara destino nenhum e a resposta
   honesta é lista vazia. No banco a mesma pergunta se responde por jsonb:
   `spec -> 'object_story_spec' -> 'link_data' ->> 'link'`.
4. **`spec` é a resposta ÍNTEGRA, sem seleção de campos.** Criativo é imutável e
   esta é a única foto que existirá dele: um campo descartado hoje porque
   ninguém consulta não teria como ser recuperado quando alguém consultar.
5. **Índices/colunas desejados, nenhuma migration criada** (`db:generate` segue
   quebrado — ticket 01). Para a migration consolidada futura, a varredura deste
   ticket consulta `meta_tracking_config_versions` por
   `(account_id, entity_level, creative_id)`: hoje o índice
   `(account_id, valid_from)` atende, mas um parcial
   `(account_id, creative_id) WHERE entity_level = 'ad' AND creative_id IS NOT NULL`
   deixaria o anti-join trivial quando o histórico crescer. Continuam pendentes
   os já anotados: GIN em `changed_fields`, UNIQUE parcial da versão vigente,
   parcial por `source` interno e
   `meta_tracking_account_coverage.metric_rows_upserted`.
6. **O field set do criativo não pôde ser validado contra a API real** (mesma
   restrição de ambiente dos tickets anteriores). Os três campos mais novos do
   catálogo — `asset_feed_spec`, `degrees_of_freedom_spec`, `instagram_user_id` —
   são os que saem no recuo por erro 100. Se a primeira execução real acusar
   recuo, é o primeiro lugar a olhar.

### Runbook da primeira execução real (para o humano)

Nada disto foi rodado: o `.env.local` do backoffice aponta para **produção** e a
migration `0044` não foi aplicada por este ticket. Continuam valendo os runbooks
dos tickets 03 e 04; o snapshot de criativos acrescenta:

1. Depois da primeira coleta de um cliente
   (`APP_ENV=<alvo> bun scripts/with-env.ts bun scripts/collect-meta-tracking.ts --user=<uuid> --max=1`),
   conferir `creativesFetched` no resumo: deve ser igual ao número de
   `creative_id` distintos das versões de anúncio da conta.
2. `SELECT id, spec -> 'object_story_spec' AS story, spec ->> 'url_tags' AS utms FROM meta_tracking_creatives LIMIT 5;`
   — o `object_story_spec` tem de vir preenchido. Se vier nulo em todos, o recuo
   por erro 100 disparou (ver aviso 6).
3. Rodar o **mesmo comando de novo** com `--all`: `creativesFetched` deve ser
   **zero** (foto única — nada é rebuscado) e `creativesPending` também.
4. Comparar a URL de um criativo com o destino real do anúncio no Gerenciador:
   `spec -> 'object_story_spec' -> 'link_data' ->> 'link'` (anúncio de link) ou
   `spec -> 'object_story_spec' -> 'video_data' -> 'call_to_action' -> 'value' ->> 'link'`
   (vídeo).
5. `creativesPending` teimoso acima de zero por vários dias = lote sendo
   recusado; olhar os erros do run.

### Verificação (ambiente)

Nenhum comando tocou Postgres real nem a Graph API — as costuras são puras e o
passo foi exercitado com portas falsas.

- `bun test lib/meta-tracking/` → **339/339** (24 novos).
- `bunx tsc --noEmit` → o **mesmo baseline pré-existente** de 11 linhas
  (`portfolio-filters.test.ts`, `users-csv.test.ts` importando `vitest`,
  `frontend-app-url.test.ts`); zero erro nos arquivos deste ticket.
- `bunx eslint` nos arquivos novos e tocados → limpo.
- `bun test` completo → 557 pass / 42 fail, **todas** as falhas nas suítes de
  integração do Programa de Afiliados e na cascata de `describe() inside another
  test()` que elas provocam (Postgres descartável em `localhost:55432` via
  Docker, ausente nesta máquina). Baseline pré-existente; nenhuma falha em
  `meta-tracking`, nenhuma falha nova.
- Fontes espelhadas intocadas: nada em `lib/meta-business/` e nada em
  `lib/meta-tracking/internal-change-event.ts`; o bloco `meta_tracking_*` do
  `schema.ts` não foi editado (a tabela já existia).

### Code review

Rodado ao final nos dois eixos (padrões do repo + spec do ticket). Sem
ferramenta de sub-agente disponível nesta sessão, os dois eixos foram
percorridos manualmente sobre o diff. Dois achados reais, corrigidos antes do
commit:

1. **Generalidade especulativa** — `maxCreatives` e `chunkSize` opcionais em
   `planCreativeFetch`, nenhum com chamador nem teste (mesmo achado que o code
   review do ticket 04 fez com `mutableDays`/`range`). Removidos; a função lê as
   constantes direto.
2. **Código duplicado** — `planCreativeFetch` reimplementava o laço de
   fatiamento em vez de reusar `chunkIds` de `daily-collection-plan.ts`. Agora
   reusa.

Mantidos conscientemente: (a) `promotionUrlsOf` sem chamador de produção — é a
forma executável do critério 4, ver aviso 3; (b) o recuo de field set por erro
100 aparecendo pela quarta vez em `graph-collector-gateway.ts` (configuração,
insights, activities, criativos) — é a forma já estabelecida do arquivo, e cada
cópia tem field set e ordem de guardas próprios; (c) os leitores privados
`asObject`/`asArray`, que **parecem** o `isRecord` de `correlation.ts` e
`quota-usage.ts` mas devolvem `| null` para encadear em vez de estreitar tipo — o
próprio repo já tem duas cópias privadas de `isRecord`.

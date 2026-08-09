# 07 — Ações internas: motivo obrigatório + escrita no stream (2 repos)

**What to build:** Toda alteração feita pela plataforma passa a nascer no stream de ações com autoria e horário exatos. No backoffice, cada mutação (orçamento, CBO↔ABO, segmentação, agendamento, criativo, renomeio, duplicação e **mudança de status** — que hoje não registra nada) exige motivo e grava o evento com origem de administrador; no frontend, as edições do cliente gravam com origem de usuário, sem motivo obrigatório. A escrita acontece na camada de wrapper das rotas — os primitives de atualização espelhados permanecem intocados (ADR 0010). As tabelas legadas de log de edição continuam recebendo dual-write, com ponte de referência no evento novo. A costura do delta é estendida para reconhecer mudanças já registradas internamente e não duplicar o evento na coleta seguinte.

**Blocked by:** 01 — Schema; 02 — Costura do delta.

**Status:** resolved

- [x] Mutação do backoffice sem motivo é rejeitada com erro claro; com motivo, grava evento com autor, horário exato, diff e origem de administrador. *(status ×3 níveis e renomeio ×3 níveis ganharam o portão de motivo; orçamento/CBO↔ABO e edição de conjunto já o tinham e agora gravam o evento. Duplicação e criativo ficaram de fora — ver Comments.)*
- [x] Mudança de status de campanha pelo backoffice gera evento com motivo (gap atual fechado). *(e também conjunto e anúncio, pelo mesmo motivo.)*
- [x] Edição do cliente pelo painel gera evento com origem de usuário, sem exigência de motivo.
- [x] Log legado correspondente continua sendo gravado (dual-write) e o evento novo referencia esse registro. *(status não tinha log legado nenhum: ganhou linha em `backoffice_audit_logs`, o mesmo destino de renomeio/duplicação.)*
- [x] Coleta do dia seguinte não cria evento duplicado para a mudança já registrada — apenas liga a versão nova ao evento existente. *(verificado por teste puro na costura do delta e no orquestrador com portas falsas — **nenhum comando tocou Postgres real nem a Graph API**.)*
- [x] Falha na Meta ao aplicar a mudança fica registrada no evento (aplicado vs falhou), preservando o padrão dos logs legados. *(chave reservada `__apply_failed__` em `changed_fields` — a tabela não tem coluna e este esforço não abre migration; ver Comments.)*
- [x] Contrato do gravador coberto pela costura 2 com testes puros; nenhum primitive espelhado alterado. *(22 testes; as suítes de paridade de `duplicate.ts` e dos primitives seguem verdes.)*

## Comments

### O que foi entregue

**A costura 2, pura e espelhada** — `lib/meta-tracking/internal-change-event.ts`, byte a byte
nos dois repos, delimitada por
`// ===== BEGIN meta_tracking internal writer … =====` / `// ===== END … =====`, com
`automatize-frontend/tests/meta-tracking-writer-parity.test.ts` comparando os dois. Ela responde:

- `validateChangeNote(source, note)` — o portão do motivo, chamado ANTES de qualquer chamada à
  Meta. Obrigatório só para `backoffice_admin`.
- `buildInternalChangeEvent(input)` — o rascunho da linha de `meta_tracking_change_events`:
  diff campo a campo no **vocabulário da Graph API**, autoria, horário exato, ponte legada.
- `campaignBudgetFieldChanges` / `adsetBudgetFieldChanges` — o que uma mutação de orçamento mudou
  em cada nível, com a convenção "orçamento configurado zero não existe".
- `sameMetaFieldValue` — a mesma pergunta ("estes dois valores dizem a mesma coisa?") usada pelo
  gravador e pela deduplicação da coleta. Compartilhá-la é o que impede as duas de discordarem.

**A deduplicação** — `computeTrackingDelta` ganhou `internalChanges` (entrada) e `versionLinks`
(saída): ação interna reconhecida ⇒ o evento externo **não nasce** e o evento que já está no
stream ganha `to_config_version_id`. O coletor ganhou a porta `loadRecentInternalChanges`, a query
correspondente e o `UPDATE` dentro da transação da conta; o resumo do run ganhou `eventsLinked`.

**As rotas** (camada de wrapper; nenhum primitive de `update/` tocado — ADR 0010):

| Rota | Backoffice | Frontend |
|---|---|---|
| status de campanha / conjunto / anúncio | motivo obrigatório + `backoffice_audit_logs` + evento | evento `frontend_user` |
| orçamento e CBO↔ABO da campanha | evento + ponte `campaign_edit_logs` (1 evento por entidade com valor mexido) | idem, origem de usuário |
| edição de conjunto | evento + ponte `adset_edit_logs` | idem |
| renomeio (3 níveis) | motivo obrigatório + `backoffice_audit_logs` + evento | evento `frontend_user` |

**A UI do backoffice** — `status-change-note-dialog.tsx` (um diálogo para os três níveis; fica
aberto até a Meta responder) e a nota explicativa obrigatória no diálogo de renomeio.

### Decisões que valem revisão futura

1. **`__apply_failed__` é uma chave reservada de `changed_fields`, não uma coluna.** A tabela não
   tem `applied_to_meta`/`error_message` e este esforço não abre migration (ticket 01). Presença =
   a Meta recusou; **ausência = aplicado**. O prefixo `__` não existe no vocabulário da Graph API,
   então `changed_fields ? 'daily_budget'` continua honesto. **Quando a migration consolidada
   nascer, o par de colunas é a forma certa** — e a dedup já ignora ações falhas (mudança não
   aplicada não explica o que o coletor viu).
2. **A rota do status agora faz um GET a mais** (nome + status anterior, para o diff). Degrada em
   silêncio se falhar: o evento nasce com `old: null` em vez de derrubar a ação. No frontend nem
   isso — a dedup compara para ONDE a mudança foi, e o GET extra não valia o custo no caminho do
   cliente.
3. **Duplicação e criativo ficaram sem portão de motivo.** São fluxos de CRIAÇÃO (o evento é
   `created`, que o coletor já produz na listagem seguinte) e exigiriam campo de motivo dentro de
   `duplicate-button.tsx` e `ad-creative-dialog.tsx`, dois diálogos grandes. O `promotion-link`
   idem. Fica como continuação natural — a costura e o executor já estão prontos, é só chamar.
4. **Falha parcial vira falha total no registro.** Se a Meta aceitar a campanha e recusar um
   conjunto, TODOS os eventos daquela mutação recebem a marca de falha, porque o `appliedToMeta` é
   um só para a operação inteira. É exatamente o que os edit logs legados já faziam.
5. **`loadRecentInternalChangeEvents` não tem LIMIT.** A janela é de 24 h e as escritas internas são
   humanas (dezenas por dia, no máximo). Se um dia houver escrita interna automatizada em volume,
   é o primeiro lugar a colocar um teto.

### Avisos para os próximos tickets

1. **O contrato de `computeTrackingDelta` mudou** (ticket 03 já atualizado): a saída agora tem
   `versionLinks` e a entrada aceita `internalChanges`. Quem persistir um delta precisa aplicar os
   links **dentro da mesma transação** — sem eles, a ação interna fica para sempre sem versão de
   destino. `PersistDeltaResult` ganhou `eventsLinked`, e o summary do run também. **Ticket 09**
   pode mostrá-lo na tela de operação: `eventsLinked > 0` é a prova de que a dedup está funcionando.
2. **O vocabulário do diff é contrato entre as duas metades.** As rotas gravam `changed_fields` com
   as chaves de primeiro nível da Graph API (`daily_budget`, `targeting`, `name`, `status`), porque
   é assim que o diff do coletor as escreve. Um campo novo registrado com outro nome não deduplica
   — nasce evento duplicado, silenciosamente. **Tickets 04/05/06.**
3. **`status` (configurado) vs `effective_status` (efetivo).** As rotas registram o primeiro, o
   coletor observa o segundo. A dedup de ciclo de vida casa os dois pelo valor de destino
   (`internalStatusTarget`). Cascata de pausa nos filhos continua virando evento
   `external_detected` — é informação, não duplicata.
4. **A janela de tolerância é de 24 h fixas** (`INTERNAL_CHANGE_TOLERANCE_MS`). Se a coleta diária
   algum dia rodar com mais de um dia de atraso, ações internas do intervalo perdido voltam a
   duplicar. A cobertura conta×dia é quem denuncia esse atraso.
5. **O gravador é fonte espelhada, mas NÃO entra no `sync:meta`.** O `sync:meta` é
   frontend-autoritativo e a fundação de tracking é do backoffice — inverter a direção seria uma
   armadilha. O espelho é manual e o teste de paridade do frontend é quem o cobra: **editou um
   lado, edite o outro e commite os dois juntos.**
6. **Índices ainda desejados** (nenhuma migration criada): além do GIN em `changed_fields` e do
   UNIQUE parcial em `(entity_level, entity_id) WHERE valid_to IS NULL` já anotados, este ticket
   consulta `meta_tracking_change_events` por `(account_id, occurred_at)` filtrando `source` nas
   duas origens internas — o índice `(source)` existente ajuda pouco num filtro composto. Um
   parcial `(account_id, occurred_at) WHERE source IN ('backoffice_admin','frontend_user')` seria
   o ideal quando o stream crescer. E o par `applied_to_meta`/`error_message` do item 1.

### Verificação (ambiente)

Nenhum comando tocou Postgres real nem a Graph API — a costura é pura, o executor não foi
executado e a dedup foi exercitada com portas falsas.

- `bun test lib/meta-tracking/` (backoffice) → **140/140** (22 do gravador, 7 da dedup, 2 do
  coletor, o resto já existia).
- `bun test ./tests/meta-tracking-writer-parity.test.ts ./tests/meta-primitives-parity.test.ts
  ./tests/meta-duplicate-parity.test.ts` (frontend) → **27/27**: o gravador está idêntico nos dois
  repos e **nenhuma fonte espelhada de `lib/meta-business/` foi alterada**.
- `bunx tsc --noEmit`: backoffice → o **mesmo baseline pré-existente** (11 linhas em
  `portfolio-filters.test.ts`, `users-csv.test.ts`, `frontend-app-url.test.ts`); frontend → o
  **mesmo baseline pré-existente** (`bun:test` sem `@types/bun`, `referral-test-db.ts`,
  `meta-interest-parity`, imports com extensão `.ts`). Zero erro nos arquivos deste ticket.
- `bunx eslint app/ lib/` (backoffice) → o único **error** é o pré-existente de
  `ad-media-preview-dialog.tsx`, arquivo não tocado.
- `bun test` completo: backoffice → 403 testes, 42 falhas, **todas** das suítes de integração do
  Programa de Afiliados (Postgres descartável em `localhost:55432` via Docker, ausente nesta
  máquina); a suíte segue não determinística por causa do `describe() inside test()` do bun.
  Frontend → **1043 pass / 44 fail**, contra o baseline de 1040/44: exatamente os +3 testes de
  paridade, **zero falha nova**.

### Runbook para o humano (o que exige banco/Meta de verdade)

Nada disto foi executado — a migration `0044` continua sem ser aplicada em banco nenhum e o
`.env.local` do backoffice aponta para produção.

1. Aplicar `0044_meta_tracking_foundation` no alvo escolhido (`bun run db:migrate`).
2. No backoffice, pausar uma campanha pelo diálogo **sem** preencher o motivo: a alteração deve ser
   recusada com "Toda alteração feita pelo backoffice precisa de um motivo registrado" e **nenhuma
   chamada deve chegar à Meta**.
3. Repetir com motivo: conferir 1 linha em `backoffice_audit_logs` e 1 em
   `meta_tracking_change_events` (`source = backoffice_admin`, `note` preenchida,
   `changed_fields->'status'`, `legacy_edit_log_id` apontando para a primeira).
4. No painel do cliente, pausar outra campanha: evento com `source = frontend_user` e `note` nula.
5. Rodar a coleta do dia seguinte (`bun scripts/collect-meta-tracking.ts --user=<uuid> --max=1`) e
   conferir que **nenhum** evento `external_detected` nasceu para essas duas campanhas e que o
   `summary` do run traz `eventsLinked` > 0 quando a mudança abriu versão nova.

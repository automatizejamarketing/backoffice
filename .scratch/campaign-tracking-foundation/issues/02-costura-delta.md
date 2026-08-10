# 02 — Costura do delta de tracking: versões + transições (pura)

**What to build:** A função pura central da fundação: recebe o estado anterior conhecido de uma conta (versões vigentes, últimos status observados) e as respostas da Graph API de hoje (listagem com status, configurações profundas das entidades ativas) e produz o delta completo — versões novas com diff campo-a-campo pré-computado, eventos de criação/mudança/transição de ciclo de vida/arquivamento, flag de Campanha Gerenciada avaliada por versão via prefixo configurável. Inclui a normalização de configuração e o hash com exclusão dos campos voláteis. Sem I/O; é a costura de teste principal, reutilizada depois pelo coletor diário, pelo backfill e pela deduplicação de escritas internas.

**Blocked by:** 01 — Schema da fundação.

**Status:** resolved

- [x] Mesma configuração duas vezes ⇒ delta vazio (idempotência).
- [x] Mudança apenas em campo volátil ⇒ nenhuma versão nova.
- [x] Transição de status efetivo (ativo↔pausado/arquivado/deletado, incl. cascata por pausa do pai) ⇒ evento de transição, sem versão nova.
- [x] Mudança real de configuração ⇒ versão nova + evento com `changed_fields` exato (velho→novo por campo).
- [x] Entidade nunca vista ⇒ evento de criação + primeira versão; entidade reativada ⇒ volta a produzir versões.
- [x] Renomeio que muda o prefixo gerenciado altera a flag apenas da versão nova (história preservada).
- [x] Fixtures derivadas de respostas reais da API v25 nos três níveis; testes colocados no padrão do runner do projeto, sem banco. *(fixtures derivadas dos field sets que este repo já usa contra a v25 + convenções observadas em produção, com **identificadores sintéticos** — nenhum dado de cliente entra em fixture.)*

## Comments

### O que foi entregue

Três arquivos novos no backoffice, nada tocado fora deles:

- **`lib/meta-tracking/config-version.ts`** — "o que é uma configuração": normalização
  (`normalizeTrackedConfig`), hash (`hashTrackedConfig`), projeção nas colunas tipadas por nível
  (`projectVersionColumns` / `projectVolatileColumns`) e a marca de gerenciada (`hasManagedPrefix`).
- **`lib/meta-tracking/compute-tracking-delta.ts`** — `computeTrackingDelta(input) → { versions,
  events, confirmations }`: "o que mudou desde ontem".
- **`lib/meta-tracking/fixtures/graph-api-v25.ts`** — campanha, conjunto e anúncio da v25.

26 testes colocados (`config-version.test.ts` 10, `compute-tracking-delta.test.ts` 16), `bun:test`,
zero banco e zero rede — o módulo puro só importa `node:crypto` e **tipos** de `@/lib/db/schema`
(`import type`, apagado na compilação).

### O contrato, para os tickets 03/05/07

```ts
computeTrackingDelta({
  userId, accountId, observedAt, managedCampaignNamePrefix,
  listing:  TrackingListingEntity[],   // TODAS as entidades: id, hierarquia, status
  configs:  TrackingConfigObservation[], // fetch profundo, só de quem está entregando
  previous: KnownEntityState[],        // versão vigente + último effective_status
}): { versions: TrackingVersionDraft[]; events: TrackingChangeEventDraft[];
      confirmations: TrackingVersionConfirmation[] }
```

**Como o executor persiste (ticket 03), na ordem:**

1. `confirmations` → `UPDATE meta_tracking_config_versions SET last_confirmed_at = …` **e as seis
   colunas voláteis** (elas mudam sem abrir versão; a confirmação traz os valores frescos).
2. Para cada `version`, **numa transação só**: se `supersedesVersionId` não for nulo,
   `UPDATE … SET valid_to = <validFrom> WHERE id = supersedesVersionId`, e então o `INSERT` da nova.
   O banco **não** impede duas versões abertas (ver aviso 2 do ticket 01) — o invariante é seu.
3. `events` → `INSERT`, trocando `toVersionRef` pelo uuid da versão inserida com aquele `ref`
   (`ref` é `"<nível>:<id da entidade>"`, único dentro de um delta).

`version.columns` e `version.volatile` já vêm no formato das colunas tipadas; `version.config` é a
resposta **integral**, para o jsonb. Datas são `Date`, dinheiro é string em unidades menores.

### Avisos para os próximos tickets

1. **Estado anterior de quem nunca esteve ativo.** `KnownEntityState.lastEffectiveStatus` de uma
   entidade sem versão não tem coluna própria em lugar nenhum: reconstrua do stream — o último
   `changed_fields->'effective_status'->>'new'` dela (o evento `created` já nasce carregando o
   estado com que a entidade foi vista, exatamente para isso). **Ticket 03.**
2. **A costura NÃO infere remoção por ausência na listagem.** Listagem interrompida por cota (a
   coleta aborta a conta com cobertura `partial`) escreveria `deleted_detected` em massa e mentira
   permanente no stream. Remoção/arquivamento só é reconhecido quando a Meta **reporta**
   `effective_status` `DELETED`/`ARCHIVED` — o que exige pedir esses estados na listagem
   (`effective_status=["ACTIVE","PAUSED","ARCHIVED",…]`), senão o edge simplesmente omite. **Ticket 03.**
3. **Caminho do backfill de graça:** alimentar a costura com `configs` e **sem** `listing` produz as
   versões iniciais (inclusive de pausadas/arquivadas) sem gerar `created` retroativo — que é
   exatamente o §6 do plano. **Ticket 05.**
4. **Nada é deduplicado contra escrita interna ainda:** todo evento nasce
   `source: "external_detected"`. A supressão do ticket 07 deve filtrar os `events` do delta (mesma
   entidade, mesmo delta, janela ±24 h) antes de inserir, e ligar a versão nova ao evento que já
   existe — a costura já entrega `toVersionRef`/`fromConfigVersionId` para isso.
5. **`is_managed` é herdado do pai em conjunto e anúncio.** O prefixo `[AM]` vive no nome da
   campanha; conjuntos e anúncios da plataforma têm nome livre, então a marca do filho vem da
   campanha **como ela se chamava naquela versão**. Decisão além da letra do ticket, tomada para a
   coluna não mentir nos três níveis (história de usuário 2). Se o ticket 08 preferir resolver por
   join em `campaign_id`, os dois caminhos concordam.
6. **Hash e normalizador andam juntos.** Mudar `VOLATILE_CONFIG_FIELDS`, `NON_CONFIG_FIELDS` ou a
   canonicalização muda todos os hashes e faz nascer **uma** versão nova por entidade na coleta
   seguinte (não é bug, mas não faça de leve). `NON_CONFIG_FIELDS` exclui `adsets`/`ads`: se o fetch
   profundo algum dia pedir filhos aninhados, é isso que impede um anúncio pausado de abrir versão
   nova da campanha.
7. **`changed_fields` usa chaves de PRIMEIRO nível** (`daily_budget`, `targeting`, `name`…), que é o
   que `changed_fields ? 'daily_budget'` do §8 interroga. Campo aninhado que muda aparece como o
   objeto inteiro velho→novo. Ausente de um dos lados vira `null`.
8. **Dinheiro:** `configuredMoney` anula `"0"` (orçamento configurado zero não existe — "0" é a
   Meta dizendo "o dinheiro está no outro nível"); `budget_remaining` **preserva o zero** (ali zero
   é "acabou o orçamento do dia", informação). O sentinela `"92233720368547758"` de `spend_cap`
   ("sem limite") é gravado **cru**: quem agregar `spend_cap` precisa filtrá-lo. Considere anulá-lo
   quando alguém for consultar essa coluna de verdade.
9. **`advantage_state` só é mapeado quando vem como string.** O plano cita também
   `advantage_state_info`, cuja forma não foi possível confirmar sem chamar a API — fica no `config`
   jsonb integral, e mapear vira uma linha quando alguém vir a resposta real.
10. **Índices que ainda faltam** (nenhuma migration foi criada — `db:generate` segue quebrado):
    além do GIN em `changed_fields` já anotado pelo ticket 01, um **UNIQUE parcial** em
    `(entity_level, entity_id) WHERE valid_to IS NULL` transformaria o invariante do item 2 do
    contrato acima em garantia de banco. Vale entrar na migration consolidada futura.

### Verificação (ambiente)

Nenhum comando tocou Postgres nem a Graph API — a costura é pura e os testes são de fixture.

- `bun test lib/meta-tracking/config-version.test.ts lib/meta-tracking/compute-tracking-delta.test.ts`
  → **26/26**.
- `bunx tsc --noEmit` → **11 linhas de erro, exatamente o baseline pré-existente**
  (`lib/backoffice/portfolio-filters.test.ts`, `lib/backoffice/users-csv.test.ts` importando
  `vitest`, `lib/env/frontend-app-url.test.ts`); zero em `lib/meta-tracking/`.
- `bunx eslint lib/meta-tracking/` → limpo.
- `bun test` completo: continua **não determinístico e com falhas pré-existentes** (319–343 testes
  entre execuções; todas as falhas são as suítes de integração do Programa de Afiliados, que exigem
  um Postgres descartável em `localhost:55432` via Docker, mais a cascata de
  `describe() inside another test()` do bun). **Nenhuma falha em `meta-tracking`.**
- Prettier **não** é dependência deste projeto e não há config: rodar `prettier --check` reprova
  também os arquivos do ticket 08 no mesmo diretório. Formatação não é padrão do repo aqui.

### Code review

Rodado ao final (dois eixos, padrões e spec). Quatro achados reais, todos corrigidos em
`7e655a9`: (1) `budget_remaining: "0"` virando NULL por reusar o helper de orçamento configurado —
o único achado de correção; (2) `unknown | null` nas colunas jsonb, que colapsa para `unknown` em
TypeScript e mentia sobre o contrato; (3) `structured` → `jsonOrNull`; (4) três construtores de
entrada quase idênticos no teste, reduzidos a um. Mantido conscientemente: a cascata
`isCampaign ? … : null` de `projectVersionColumns` — ela espelha "uma tabela para três níveis" e
se lê como tabela.

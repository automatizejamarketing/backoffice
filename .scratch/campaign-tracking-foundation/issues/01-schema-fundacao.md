# 01 — Schema da fundação de tracking (expand, nos dois repos)

**What to build:** As sete tabelas `meta_tracking_*` (versões de configuração, métricas diárias, eventos de mudança, eventos crus de atividade, runs, cobertura por conta×dia, criativos) existem no banco compartilhado com índices e uniques conforme o plano aprovado, os tipos inferidos estão exportados e os dois projetos (backoffice e frontend) compilam com o schema espelhado. Nenhuma lógica — este é o "expand" que destrava todos os outros tickets, e o único que toca migration.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [ ] Migration additiva gerada no backoffice (dono da mudança) e aplicada com o migrador custom do projeto — nunca push direto. *(gerada; **apply pendente** — ver Comments)*
- [x] Schema espelhado byte-compatível no frontend, com o journal de migrations do frontend em sincronia (regra dos CLAUDE.md dos dois projetos).
- [x] Campos voláteis (estado efetivo, orçamento restante, fase de aprendizado, avisos) presentes nas versões mas documentados como fora do hash, no comentário da tabela.
- [x] Uniques garantem idempotência: versão por (nível, entidade, hash, vigência), métrica por (nível, entidade, dia), cobertura por (conta, dia), atividade por chave composta de dedup.
- [ ] `bun test` e build passam nos dois projetos; nenhuma tabela ou coluna existente alterada. *(nenhuma tabela/coluna existente alterada ✔; `bun test` completo **não** passa nos dois repos por falhas pré-existentes de ambiente — ver Comments)*

## Comments

### O que foi entregue

- **7 tabelas** `meta_tracking_{runs, account_coverage, activity_events, config_versions, change_events, daily_metrics, creatives}` conforme §4 do plano, com todas as colunas tipadas por nível, os JSONB integrais, os uniques e os índices.
- **Bloco espelhado** entre `backoffice/lib/db/schema.ts` e `automatize-frontend/lib/db/schema.ts`, delimitado por
  `// ===== BEGIN meta_tracking_* … =====` / `// ===== END meta_tracking_* =====`.
  O espelho deixou de ser disciplina individual: `automatize-frontend/tests/meta-tracking-schema-parity.test.ts`
  compara os dois blocos e falha se um lado for editado sozinho. **Edite os dois juntos.**
- **Migration** `backoffice/lib/db/migrations/0044_meta_tracking_foundation.sql`, byte-idêntica em
  `automatize-frontend/lib/db/migrations/0052_meta_tracking_foundation.sql`, com a mesma entrada de journal
  (`when: 1793200000000`) nos dois — o padrão dos pares já existentes (`0043`/`0051`): quem rodar primeiro
  aplica, o outro pula, porque o migrador compara `created_at`. Só `CREATE TABLE`/`CREATE INDEX`, tudo
  `IF NOT EXISTS`. Nenhuma tabela ou coluna existente foi tocada.
- **Tipos exportados** para os próximos tickets: `MetaTrackingEntityLevel`, `MetaTrackingBudgetMode`,
  `MetaTrackingChangedFields`, `MetaTrackingChangeKind`, `MetaTrackingChangeSource`, `MetaTrackingRunKind`,
  `MetaTrackingRunTriggeredBy`, `MetaTrackingRunStatus`, `MetaTrackingCoverageStatus` + os sete
  `InferSelectModel`.

### ⚠️ O apply da migration está PENDENTE — e por quê

**O ambiente padrão do backoffice aponta para PRODUÇÃO.** `APP_ENV` não setado ⇒ `local` ⇒ `.env.local`, e o
`POSTGRES_URL` de lá é o project-ref `hosjqwtfjjtmphchsuqf` — o mesmo que `automatize-frontend/.env.prod`
usa, com `STRIPE_SECRET_KEY=sk_live` no mesmo arquivo e **328 usuários / 171 assinaturas** no banco. O
`.env.staging`/`.env.prod` do backoffice apontam, invertidos, para a staging (`wsbsnzgzqiehqnklzchm`,
`sk_test`, 15 usuários). Isso não é suposição: `backoffice/tests/referral/setup.ts` e
`automatize-frontend/scripts/referral-test-db.ts` **documentam essa inversão por escrito**, nomeando
`hosjqwtfjjtmphchsuqf` como produção.

Rodar `bun run db:migrate` no ambiente padrão seria rodar em produção, então **não foi rodado**.

O DDL foi validado assim mesmo, sem tocar em dado nenhum: aplicado dentro de uma transação **revertida** no
banco de staging — 7 tabelas e 30 índices criados, `ROLLBACK`, zero resíduo. E um comparador rodou
`information_schema` × `getTableConfig` coluna a coluna: **nenhum drift** entre `schema.ts` e o SQL (nome,
nulabilidade, presença de default e todos os índices batem).

**Para quem for aplicar:** decida o alvo e rode `bun run db:migrate` no backoffice (nunca `db:push`, nunca
`drizzle-kit migrate` direto). Antes disso, vale arrumar a inversão dos `.env` — ela é uma armadilha ativa
para qualquer agente ou pessoa que rode um comando de banco no default.

### `bun run db:generate` está quebrado neste repo (pré-existente)

```
Error: [meta/0017_snapshot.json, meta/0024_snapshot.json] are pointing to a parent snapshot:
meta/0017_snapshot.json/snapshot.json which is a collision.
```

Os dois snapshots têm o mesmo `prevId` (`973256ca`, do `0014`). Nada foi escrito quando o comando falhou.
Por isso — e é o que as **19 migrations anteriores** já vinham fazendo — o SQL foi escrito à mão, no mesmo
estilo da casa (comentário em pt-BR, `IF NOT EXISTS`, nomes de constraint explícitos). Consertar a cadeia de
snapshots é ticket próprio: reescreve metadado que a `staging` e outras branches compartilham, e faria o
próximo `generate` cuspir tudo de `0025` a `0043` junto.

### Testes

- `backoffice/tests/meta-tracking-schema.test.ts` — 13 testes: os quatro uniques de idempotência, os campos
  voláteis, o índice parcial da versão vigente, as ligações do stream. **13/13 passam.**
- `automatize-frontend/tests/meta-tracking-schema-parity.test.ts` — 3 testes: bloco idêntico nos dois
  `schema.ts`, sete tabelas presentes dos dois lados, migration registrada nos dois journals.
  **3/3 passam.** (O `tests/` do frontend é gitignorado — `/tests/` na linha 65 — então foi `git add -f`,
  como os outros 25 arquivos de contrato/paridade já versionados de lá.)
- **A suíte completa NÃO passa em nenhum dos dois repos, por motivo anterior a este ticket:** as suítes de
  integração do Programa de Afiliados exigem um Postgres descartável em `localhost:55432/referral_test`
  (`bun scripts/referral-test-db.ts up`), e o engine do Docker não está de pé nesta máquina. No frontend a
  medição é limpa: baseline 1037 pass / 44 fail; com este ticket 1040 pass / **44 fail** — exatamente os +3
  testes novos, zero falhas novas. No backoffice a suíte é não-determinística por conta desse mesmo problema
  (de 250 a 377 testes chegam a rodar entre execuções, por causa do
  `describe() inside another test()` do bun em cascata) — nenhuma das falhas é de `meta_tracking_*`.

### Avisos para os próximos tickets

1. **O unique da versão sozinho NÃO garante idempotência** — `(entity_level, entity_id, config_hash,
   valid_from)` só colide se o `valid_from` for o mesmo. Com `valid_from = now()`, reexecutar a coleta no
   mesmo dia **criaria uma segunda linha**. O coletor (**ticket 02/03**) tem de comparar com a versão
   vigente (`valid_to IS NULL`) primeiro e, se o hash bater, apenas mexer em `last_confirmed_at`. O unique é
   rede de segurança, não a regra.
2. **Um índice parcial UNIQUE em `(entity_level, entity_id) WHERE valid_to IS NULL`** — que travaria "duas
   versões abertas para a mesma entidade" no banco — foi deliberadamente **não** criado: o §4.1 do plano
   lista esse índice como comum, não único. Se o ticket 02 quiser essa garantia, é uma migration aditiva de
   uma linha (e exige fechar a versão velha antes de abrir a nova, na mesma transação).
3. **`meta_tracking_activity_events.matched_change_event_id` não tem FK** (o par de FKs mútuas obrigaria a
   ordenar inserts que o matcher faz em qualquer ordem). A ponte canônica é
   `meta_tracking_change_events.activity_event_id`, essa sim com FK. **Ticket 06** deve escrever os dois lados.
4. **`dedup_hash` é sha256 de `(account_id, event_type, event_time, object_id, actor_id)`**, e não um unique
   composto, porque `object_id`/`actor_id` vêm nulos em parte dos eventos e NULL não colide com NULL no
   Postgres — o composto deixaria passar duplicata justo na sobreposição de 48 h do poll. **Ticket 06**
   precisa computar o hash exatamente com esses cinco campos, nessa ordem.
5. **Não existe índice GIN em `changed_fields`.** O §4.3 não pediu, mas `findActions` (§8, **ticket 08**)
   filtra por `changed_fields ? 'daily_budget'`. Se a busca doer, é uma migration aditiva de uma linha.
6. **Dinheiro:** `daily_budget`/`lifetime_budget`/`spend_cap`/`bid_amount` chegam da Meta em unidades
   menores (centavos); `spend`, dos insights, vem em unidades maiores. Todos são `numeric`. Não some os dois
   sem converter.
7. `docs/plans/campaign-tracking-foundation.md` e `.scratch/campaign-tracking-foundation/spec.md` ainda estão
   **fora do git** (untracked). O comentário do `schema.ts` e o cabeçalho do SQL apontam para o plano — vale
   alguém commitá-los.

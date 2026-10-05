# Backoffice Meta Audiences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar a experiência de criação e gerenciamento de públicos personalizados da Meta do frontend para a página e o contexto de campanha com IA do backoffice.

**Architecture:** Reutilizar os endpoints e editores administrativos existentes, adaptando o workspace e a biblioteca da fonte. Os componentes continuam escopados por `userId + accountId`; a biblioteca em campanha usa a mesma implementação em apresentação embutida. A navegação contextual confirma a conta solicitada após carregar as contas acessíveis, com estados separados de carregamento, erro e vazio.

**Tech Stack:** Next.js 16.1.1, React 19.2.3, TypeScript, Tailwind 4, shadcn/Radix, bun, node:test sob bun, agent-browser 0.38.1.

**Spec:** `docs/superpowers/specs/2026-10-05-backoffice-meta-audiences-design.md` (aprovado).

## Global Constraints

- Todas as consultas e mutações continuam em `/api/meta-marketing/[accountId]/audiences`, incluindo `userId`, e nas rotas filhas de `customer-file`.
- Reutilizar o RBAC e a reautorização de acesso ao cliente/conta/objeto existentes no servidor. Tokens Meta não entram no cliente.
- Não há necessidade identificada de dependências novas, schema ou migrations.
- Seguir os componentes e tokens do backoffice; copiar a hierarquia visual e os textos de fluxo da fonte sem introduzir outro sistema de design.
- A mudança de cliente ou conta descarta o workspace, cursores, dados e respostas pendentes da seleção anterior. O manager é chaveado por `userId:accountId` nas duas entradas.
- Criar ou editar um público nunca o aplica automaticamente à campanha.
- Instagram 1–365 dias, site 1–180 dias; períodos antigos fora da faixa são preservados quando inalterados.
- Não transformar `manageMembers="unknown"` em permissão concedida; preservar as validações e os bloqueios existentes.
- Não executar criação/edição/exclusão na Meta real, migrations ou escrita no banco compartilhado para obter evidências.
- Toda tarefa de UI inclui verificação com agent-browser contra o app rodando e screenshot salvo no workspace deste plano.
- Implementers um por vez; cada tarefa termina em commit, relatório com evidência RED/GREEN e task review independente.
- O usuário já aprovou design, plano após self-review e execução Subagent-Driven. Decisões rotineiras são rulings registrados, sem novas perguntas.
- Todos os subagentes usam o papel explícito `automatize-sonnet-high` fixado pelo harness. Fast mode não tem parâmetro exposto.
- Preservar ledger, relatórios e screenshots ao terminar; entrega inclui branch commitada, push e PR contra `main`, sem merge.

## Review Focus

1. **Conta solicitada fora da lista acessível ou `act_` versus dígitos:** não abrir silenciosamente outra conta; normalizar IDs para comparação e solicitar seleção explícita se inválida (Task 2, testes de resolução e UI).
2. **Troca de cliente/conta enquanto há uma consulta ou formulário aberto:** respostas antigas não podem reaparecer ou enviar para o contexto novo (Task 1 manager, Task 2 página, browser com respostas atrasadas).
3. **Público externo/composto, semelhante ou lista sem capacidade conhecida:** resolver metadados sem converter regras ou conceder gestão de membros (Task 1, testes comportamentais de classificação).
4. **Formulário dentro do painel IA e viewport estreita:** fluxo inline, controles acessíveis, sem overflow e sem aplicar targeting (Task 1 surface, Task 2 integração, agent-browser desktop/mobile/embutido).
5. **Falha de leitura ou resposta incerta após confirmação:** erro visível, capacidade de retornar, reconciliação existente preservada e nenhum falso sucesso (Task 1, suíte existente de operações e browser com fixture de reconciliação; Task 2 estado de erro das contas).

## File Structure and References

Raiz de trabalho: `D:/automatize-marketing/.worktrees/backoffice-audiences/backoffice`.
Fonte somente leitura: `../automatize-frontend/app/app/(main)/marketing/audiences/` no SHA `5942cc2e`.

- `audiences/audience-kind.ts`: funções puras de tipo, editor, tamanho e status, portadas da fonte.
- `audiences/audience-workspace.tsx`: escolha de origem e renderização de um único editor, com `userId` em cada editor e apresentação dialog/inline.
- `audiences/audience-library-manager.tsx`: consulta, paginação, lista e estado do workspace; uma implementação para page/embedded.
- Editores existentes no mesmo diretório: apresentação plain e valores iniciais necessários ao workspace, mantendo suas requests administrativas.
- `audiences/audience-account-selection.ts`: resolução pura da conta solicitada e construção da URL contextual; reutilizar `matchAdAccountId`/normalização já presente quando possível, sem importar servidor no cliente.
- `audiences/page.tsx`: carregar contas do cliente e representar loading/error/empty/invalid/ready.
- `marketing/components/marketing-workspace.tsx`: link contextual da biblioteca.
- `marketing/ai/ai-advanced-audience-sheet.tsx`: manager com `surface="embedded"`.
- `app/embed/marketing/audiences/page.tsx`: entrada equivalente sob layout embed, com `requirePagePermission("marketing:write")`, seguindo `app/embed/marketing/ai/page.tsx`.
- Testes: classificação e seleção puras; contratos de integração existentes atualizados para os componentes realmente compartilhados. A interação renderizada é verificada no navegador.

## Preparation and Evidence

Preparação realizada pelo orquestrador após self-review do plano, antes da Task 1. Não é uma tarefa de produto separada.

1. `bun install --frozen-lockfile` nas duas worktrees. Não modificar locks ou dependencies; conferir `git diff -- bun.lock package.json`.
2. Copiar apenas `.env.staging` da checkout primária do backoffice para a worktree; não copiar `.env`/`.env.local` e não imprimir segredos.
3. Resolver workspace SDD com Git Bash: `bash <skill>/scripts/sdd-workspace docs/superpowers/plans/2026-10-05-backoffice-meta-audiences.md`. Scripts do skill ficam em `C:/Users/rafae/.codex/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/`.
4. Gravar ledger `progress.md`, primeiro cabeçalho identificando o plano, tabela de preflight e rulings. Copiar os logs iniciais de `.scratch/backoffice-audiences/baseline` para o workspace e medir baseline completa/TypeScript nas worktrees preparadas.
5. Criar `docs/superpowers/plans/2026-10-05-backoffice-meta-audiences/evidence/` para screenshots, snapshots e relatório de comandos. Artefatos de teste grandes ficam no workspace SDD; não incluir segredos em evidências ou git.
6. Iniciar app em porta exclusiva livre, proposta 3016:

```powershell
$env:APP_ENV = 'staging'
bun scripts/with-env.ts bun node_modules/next/dist/bin/next dev --webpack -p 3016
```

7. Autenticar apenas localhost com o mecanismo existente de `backoffice_magic_session`; usar um admin allowlisted (`lib/config.ts`). Gerar token com `createBackofficeMagicSessionToken` e gravar em arquivo privado temporário, sem imprimir; instalar cookie com `agent-browser --session backoffice-audiences-task1 cookies set backoffice_magic_session <token> --url http://localhost:3016 --httpOnly`. Apagar arquivo privado no fim.
8. Antes de abrir cada página, bloquear requisições `/api/meta-marketing/**` não cobertas e configurar fixtures para `/api/users/<id>/ad-accounts`, biblioteca detalhada, fontes, importação, revisão e confirmação. A CLI aceita `network route <glob> --abort` e `--body <json>`; não oferece status customizado. Para estados HTTP de erro e lógica por `body.action`, usar init script/fixture de `fetch` instalado antes de hidratar a página, com default que recusa a rede para endpoints Meta não cobertos. Conferir ajuda da versão instalada. Fixtures são do navegador e não alteram produto.
9. Sessões browser separadas por agente/tarefa, e fixtures próprias. Nunca publicar token em relatório/HAR. Para IA, interceptar as APIs do fluxo para alcançar a revisão com dados determinísticos, sem chamar AI Gateway.

Baseline completa (PowerShell, Postgres local descartável quando disponível; não direcionar testes de integração para staging):

```powershell
$env:POSTGRES_URL = 'postgres://postgres:referral@localhost:55452/referral_test'
$env:FRONTEND_ROOT = 'D:/automatize-marketing/.worktrees/backoffice-audiences/automatize-frontend'
$env:BACKOFFICE_ROOT = 'D:/automatize-marketing/.worktrees/backoffice-audiences/backoffice'
bun test --timeout 30000
bunx tsc --noEmit -p .
```

Rodar na raiz de cada app; `bun test tests/` não é suíte completa. Registrar environment availability e nomes exatos de falhas. Falhas de base não são atribuídas à feature, mas não são ocultadas. Qualquer falha nova entra no fix loop.

### Task 1: Portar a biblioteca e o workspace de criação/edição

**Files:**
- Create: `app/(admin)/marketing/audiences/audience-kind.ts`
- Create: `app/(admin)/marketing/audiences/audience-workspace.tsx`
- Modify: `app/(admin)/marketing/audiences/audience-library-manager.tsx`
- Modify: `app/(admin)/marketing/audiences/instagram-audience-editor.tsx`
- Modify: `app/(admin)/marketing/audiences/website-audience-editor.tsx`
- Modify: `app/(admin)/marketing/audiences/lookalike-audience-creator.tsx`
- Modify: `app/(admin)/marketing/audiences/customer-list-import.tsx`
- Modify: `app/(admin)/marketing/audiences/audience-metadata-editor.tsx`
- Test: `tests/audience-kind.test.ts`
- Test: `tests/audience-library-manager.test.ts`
- Test: existing `tests/audience-period-copy.test.ts`, `tests/audience-metadata-update.test.ts`, `tests/audience-integration.test.ts`

**Interfaces:**
- Consumes: existing editor props `{ accountId: string; userId: string; audience?: CustomAudienceView; onSaved: () => void }`; existing customer importer uses `onChanged`.
- Produces: `AudienceCreateKind = "customer" | "instagram" | "website" | "lookalike"`, `AudienceEditKind = "customer" | "instagram" | "website" | "metadata"`.
- Produces: `audienceTypeLabel`, `resolveAudienceEditKind`, `audienceStatusLabel`, `audienceEstimateLabel`, receiving `CustomAudienceView` and returning strings/editor kinds as in the source.
- Produces: `AudienceLibraryManager({ accountId, userId, surface = "page" }: { accountId: string; userId: string; surface?: "page" | "embedded" })`.
- Produces: `AudienceWorkspaceState` discriminated union `{ view: "create-type" } | { view: "create"; kind: AudienceCreateKind } | { view: "edit"; audience: CustomAudienceView; kind: AudienceEditKind }`.
- Produces: `AudienceWorkspace` source contract plus `userId: string`, `surface: "dialog" | "inline"`, callbacks `onClose`, `onBackToTypes`, `onSelectKind`, `onSaved`.
- Produces: editor `chrome?: "disclosure" | "plain"` (metadata uses `"dialog" | "plain"`); importer `defaultAudienceId?: string`, `defaultOperation?: "create" | "add" | "remove" | "replace"`.

- [ ] **Step 1: Write behavioral tests for classification and formatting before creating the module.** Build valid typed fixtures, not type casts hiding required fields:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { CustomAudienceView } from "../lib/meta-business/marketing/audiences/types";
import { resolveAudienceEditKind, audienceTypeLabel, audienceEstimateLabel, audienceStatusLabel } from "../app/(admin)/marketing/audiences/audience-kind";

const base: CustomAudienceView = {
  id: "aud-1", subtype: "CUSTOM", ruleSummary: "not_applicable",
  capabilities: { read: "available", include: "unknown", exclude: "unknown",
    editMetadata: "available", share: "unknown", editRule: "unknown",
    manageMembers: "unknown", delete: "unknown", lookalikeSource: "unknown" },
};
test("unknown members capability stays metadata-only", () => {
  assert.equal(resolveAudienceEditKind(base), "metadata");
  assert.equal(audienceTypeLabel(base), "Lista de clientes");
});
test("proven member capability opens the customer editor", () => {
  assert.equal(resolveAudienceEditKind({ ...base, capabilities: { ...base.capabilities, manageMembers: "available" } }), "customer");
});
test("lookalike without a representable rule keeps metadata editing", () => {
  assert.equal(resolveAudienceEditKind({ ...base, subtype: "LOOKALIKE" }), "metadata");
  assert.equal(audienceTypeLabel({ ...base, subtype: "LOOKALIKE" }), "Semelhante");
});
test("missing estimates and statuses have source fallbacks", () => {
  assert.equal(audienceEstimateLabel(base), "—");
  assert.equal(audienceStatusLabel(base), "Não informado");
  assert.equal(audienceStatusLabel({ ...base, operationStatus: { description: "Processando" }, deliveryStatus: { description: "Pronto" } }), "Pronto");
});
```

Add cases using the real builders in `audiences/instagram.ts` and `audiences/website.ts`: representable Instagram → instagram, website → website, compound/external rule → metadata, zero estimate stays zero, bounded estimate is formatted pt-BR. Read their existing tests for exact builder signatures. These test real helper behavior.

- [ ] **Step 2: RED.** Run `bun test tests/audience-kind.test.ts`, save output with missing module failure to report.

- [ ] **Step 3: Port pure functions and workspace from the reference.** Read complete source files once; carry `userId` through every editor and keep client imports free of server modules. Port source selection cards, headers, back/close logic and plain presentation. Keep the existing local Meta endpoints and review/reconciliation implementations.

```tsx
<InstagramAudienceEditor accountId={accountId} userId={userId}
  audience={state.audience} chrome="plain" onSaved={onSaved} />
<CustomerListImport accountId={accountId} userId={userId} audiences={audiences}
  defaultAudienceId={state.audience.id} defaultOperation="add"
  chrome="plain" onChanged={onSaved} />
```

The workspace owns create/edit selection, not authorization. For customer edit use the audience's ID with proven capability only. Each opened editor must remount/reset when switching target; key by view/kind/audience ID if needed so defaults cannot leak between edits.

- [ ] **Step 4: Update manager to the source layout and surface.** Preserve `userId` in detailed/page/customer history requests. Replace permanently rendered forms with `AudienceWorkspace`. Show labels, empty state, pagination and pending import state. On save refresh and close the workspace. On account/client changes discard state and ignore earlier request completion. While a new library page is loading, do not expose stale mutation targets; pagination actions must not race cursor state.

```tsx
<AudienceWorkspace accountId={accountId} userId={userId}
  audiences={library.audiences} state={workspace}
  surface={surface === "embedded" ? "inline" : "dialog"}
  onSelectKind={(kind) => setWorkspace({ view: "create", kind })}
  onBackToTypes={() => setWorkspace({ view: "create-type" })}
  onClose={() => setWorkspace(null)}
  onSaved={() => { setRefreshKey((key) => key + 1); setWorkspace(null); }} />
```

Keep layout usable at the narrower embedded container width, not only the browser viewport. Existing deletion control remains scoped by `accountId + userId`; do not port frontend-only font classes into backoffice controls.

- [ ] **Step 5: Update integration contracts and GREEN.** Existing `tests/audience-library-manager.test.ts` should still prove page/campaign share the manager and no targeting callback exists. Add checks for workspace reuse and userId propagation only where meaningful; avoid tests that enumerate every CSS token. Run:

```powershell
bun test tests/audience-kind.test.ts tests/audience-library-manager.test.ts tests/audience-period-copy.test.ts tests/audience-metadata-update.test.ts tests/audience-integration.test.ts tests/website-audience.test.ts tests/instagram-audience.test.ts
bunx tsc --noEmit -p .
```

Compare TypeScript output to baseline; no new errors in touched code. Record exact output and pass counts.

- [ ] **Step 6: agent-browser against running app.** Use task-specific authenticated session and safe fixtures. Open `/marketing/audiences?userId=fixture-user&accountId=222`. Verify populated/empty library, next/previous, all four create types, back, close, Instagram/site fields and review, lookalike eligible/blocked origin, customer upload/preview/terms states, metadata edit fallback, deletion review, confirmation and reconciliation failure state. At 390×844 and desktop capture at least `task1-library-desktop.png`, `task1-create-types.png`, `task1-instagram.png`, `task1-site.png`, `task1-customer.png`, `task1-lookalike.png`, `task1-library-mobile.png`. Verify `document.documentElement.scrollWidth <= window.innerWidth`, focus and accessible close/return controls. Save requests/snapshots with synthetic data only. Embedded UI is wired and fully traversed in Task 2.

- [ ] **Step 7: Self-review, report and commit.** Report changed files, exact RED/GREEN outputs, screenshots, limitations and concerns to the supplied report path. Commit only Task 1 product/test changes (evidence files stay available locally); do not commit `.env`, tokens or generated build caches.

### Task 2: Preservar contexto de conta e integrar a experiência em campanha/iframe

**Files:**
- Create: `app/(admin)/marketing/audiences/audience-account-selection.ts`
- Modify: `app/(admin)/marketing/audiences/page.tsx`
- Modify: `app/(admin)/marketing/components/marketing-workspace.tsx`
- Modify: `app/(admin)/marketing/ai/ai-advanced-audience-sheet.tsx`
- Create: `app/embed/marketing/audiences/page.tsx`
- Test: `tests/audience-account-selection.test.ts`
- Test: `tests/audience-library-manager.test.ts`

**Interfaces:**
- Consumes: Task 1 `AudienceLibraryManager` with `surface?: "page" | "embedded"` and existing `AdAccountSelector`/API account list.
- Produces: `resolveAudienceAccountId(accounts: Array<{ account_id: string; id?: string }>, requestedAccountId: string | null): string | null`. Match canonical/prefixed account IDs, return first accessible account only when requested is absent, return null when requested is invalid/inaccessible.
- Produces: `buildAudienceLibraryHref({ userId, accountId, embedded }: { userId: string; accountId: string | null; embedded?: boolean }): string` using URLSearchParams and `/embed` prefix.
- Page ready state uses manager `key={`${userId}:${selectedAccountId}`}` with exactly matching client/account props. Requested account from URL cannot bypass accounts fetch or RBAC.

- [ ] **Step 1: Write failing behavioral tests for resolution and navigation.**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { resolveAudienceAccountId, buildAudienceLibraryHref } from "../app/(admin)/marketing/audiences/audience-account-selection";
const accounts = [{ id: "act_111", account_id: "111" }, { id: "act_222", account_id: "222" }];
test("explicit second account is preserved", () => assert.equal(resolveAudienceAccountId(accounts, "222"), "222"));
test("Meta prefix represents the same accessible account", () => assert.equal(resolveAudienceAccountId(accounts, "act_222"), "222"));
test("inaccessible requested account never falls back silently", () => assert.equal(resolveAudienceAccountId(accounts, "999"), null));
test("absent request keeps the first-account default", () => assert.equal(resolveAudienceAccountId(accounts, null), "111"));
test("empty list has no default", () => assert.equal(resolveAudienceAccountId([], null), null));
test("embed link carries both boundaries and encodes parameters", () => {
  const href = buildAudienceLibraryHref({ userId: "client & 1", accountId: "222", embedded: true });
  const url = new URL(href, "http://localhost");
  assert.equal(url.pathname, "/embed/marketing/audiences");
  assert.equal(url.searchParams.get("userId"), "client & 1");
  assert.equal(url.searchParams.get("accountId"), "222");
});
```

Add malformed/empty/prefixed IDs and ordinary href without account; malformed requested value must not be treated as absent. Run `bun test tests/audience-account-selection.test.ts` and record RED.

- [ ] **Step 2: Implement pure selection/navigation helper.** Use existing client-safe account normalization if applicable, otherwise strip only known `act_` prefix, validate digits and compare to accessible accounts. URL building uses `URLSearchParams`, not unescaped interpolation.

```ts
export function buildAudienceLibraryHref({ userId, accountId, embedded = false }: {
  userId: string; accountId: string | null; embedded?: boolean;
}) {
  const query = new URLSearchParams({ userId });
  if (accountId) query.set("accountId", accountId);
  return `${embedded ? "/embed" : ""}/marketing/audiences?${query}`;
}
```

- [ ] **Step 3: Implement account loading state and safe navigation.** Preserve loading/error/empty distinctions and show a selector even when requested account is inaccessible, allowing explicit recovery. Ignore old responses after client change. Gate all account data with the client identity that loaded it; clearing/loading should not briefly expose an old manager. Account change updates state only for the current loaded client.

```tsx
<AudienceLibraryManager key={`${userId}:${selectedAccountId}`}
  userId={userId} accountId={selectedAccountId} />
// marketing-workspace button:
router.push(buildAudienceLibraryHref({ userId: selectedUser.id,
  accountId: selectedAccountId, embedded }));
```

Implement explicit messages: loading accounts, failed load with visible error/retry, choose client, no accessible accounts, requested account unavailable. No manager mounts until the current client's accounts are loaded and selection is valid.

- [ ] **Step 4: Wire embedded contexts without changing targeting semantics.** In the existing sheet:

```tsx
<AudienceLibraryManager key={`${userId}:${accountId}`}
  accountId={accountId} userId={userId} surface="embedded" />
```

Add `/embed/marketing/audiences` server wrapper following the adjacent AI wrapper: require `marketing:write`, reuse the client page, and use Suspense if the existing pattern requires it. Keep the sheet tabs and `onInclusionsChange`/`onExclusionsChange`/`onDemographicsChange` untouched. No audience-selection callback is added to the manager.

- [ ] **Step 5: Update contracts and GREEN.** Contracts assert actual shared component/surface and embed permission boundary. Run:

```powershell
bun test tests/audience-account-selection.test.ts tests/audience-kind.test.ts tests/audience-library-manager.test.ts tests/audience-period-copy.test.ts tests/ai-audience-inclusions.test.ts tests/ai-audience-exclusions.test.ts
bunx tsc --noEmit -p .
```

- [ ] **Step 6: agent-browser against running app.** Use task-specific session/fixtures. From marketing or client hub on account 222 click Públicos and verify URL/selection/payloads retain account 222. Repeat under `/embed` and confirm no nested admin sidebar. Exercise missing user, loading, account failure, empty list, inaccessible requested ID (no library call until manual selection), switch accounts, and switch user with slow old response. In IA reach review through fixtures, snapshot answers/targeting before opening **Configurações avançadas de público**, enter **Públicos da conta**, create/edit/cancel inline, return to review and compare answers/targeting unchanged. Run viewport 390×844 and desktop, plus narrow embedded panel; assert no overflow and controls usable. Save `task2-account-preserved.png`, `task2-invalid-account.png`, `task2-embed-library.png`, `task2-ai-inline.png`, `task2-ai-mobile.png`, state comparison and network scope assertions.

- [ ] **Step 7: Self-review, report and commit.** Record exact tests, screenshots, runtime checks, changed files and concerns; commit the task. No upstream/main changes or push yet.

## Final Evaluation and Delivery

After both task reviews pass, generate whole-branch review package from `7c5a273` to HEAD and dispatch exactly one evaluator with spec, this plan, package, ledger and evidence paths. The evaluator reads `superpowers:requesting-code-review/code-reviewer.md` and personally:

1. Reviews the whole diff and all deferred/parked rulings.
2. Builds R1–R10 acceptance matrix with file:line, tests and screenshots.
3. Runs complete `bun test --timeout 30000` and TypeScript in both repos using the explicit sibling variables; compares to prepared baseline, reports counts/failures accurately.
4. Creates its own agent-browser session and repeats the flows above on the running app, saving independent screenshots and observing scope/targeting behavior. Does not accept implementer reports as runtime proof.
5. Returns **APROVADO** or **REPROVADO** with defects; on failure a single residual-fix worker receives the whole finding list, followed by new evaluation until approved.

R10 cannot pass remote PR creation before that action exists. Generate PR as draft with the completed commits and mark it ready after approval, or have evaluator mark R10 delivery-pending and recheck it after push/PR. The evaluator must verify R10 before the final complete acceptance report. No merge is permitted.

Persist a compact delivery report mapping requirements to changes, exact commands, log/screenshot locations, verdict, all rulings with cost if wrong, and known base/source limitations. Then push `feat/backoffice-audiences` to origin, open PR against `main` with the report and validation evidence, attach the PR to the chat, and keep the worktree/artifacts available for review.

## Plan Self-Review

- Spec coverage: R1 Task 1 manager + Task 2 sheet; R2 Task 1 list; R3 Task 1 workspace; R4–R5 Task 2 helper/page plus Task 1 state; R6–R7 Task 1 editors/operations; R8 Task 2 campaign comparison; R9 browser steps in both tasks; R10 delivery + evaluator remote verification.
- Placeholder scan: no undecided feature or placeholder instructions; source files and existing validators are explicit references, not missing implementation.
- Type consistency: both tasks use the same surface values, user/account props, workspace union and editor chrome/default contracts.
- Review Focus: each of five risks has a owning task and behavioral/runtime check.
- Work is two related UI units, each independently reviewable. Preparation/fixtures/evidence belong to the deliverables, not extra review-only tasks.
- User's explicit approval policy replaces an additional plan-review question; this self-reviewed plan proceeds directly to SDD.

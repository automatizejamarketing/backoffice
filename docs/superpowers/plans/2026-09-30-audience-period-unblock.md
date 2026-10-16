# Destravar públicos de site e Instagram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Liberar a criação de públicos de site e do Instagram (frontend e backoffice) preenchendo o registro de evidência de período com os limites documentados pela Meta e aplicando esses limites no servidor e na tela.

**Architecture:** Abordagem A da spec. `WEBSITE_PERIOD_EVIDENCE` / `INSTAGRAM_PERIOD_EVIDENCE` passam a ter valores documentados; com isso `*PeriodEvidenceStatus()` devolve `"ready"` e o campo de período aparece sozinho. Um helper puro (`websitePeriodOutOfRange` / `instagramPeriodOutOfRange`) decide se o período respeita os limites, com a exceção de "período existente inalterado". A revisão no servidor e os editores usam o mesmo helper. O backoffice tem cópia própria (não espelhada) e recebe a mesma mudança.

**Tech Stack:** Next.js 16 + React 19, TypeScript, bun (`bun test` com `node:test`), `agent-browser` 0.38.1 para verificação de tela.

**Spec:** `docs/superpowers/specs/2026-09-30-audience-period-unblock-design.md` (comitada nos dois repositórios: frontend `1ada9804`, backoffice `c5bc2f7`).

## Workspaces

| Repositório | Worktree | Branch |
|---|---|---|
| frontend | `D:/automatize-marketing/automatize-frontend-audience-period` | `fix/audience-period-unblock` |
| backoffice | `D:/automatize-marketing/backoffice-audience-period` | `fix/audience-period-unblock` |

**Workspace do plano** (evidências, bases, ledger): `D:/automatize-marketing/automatize-frontend-audience-period/docs/superpowers/plans/2026-09-30-audience-period-unblock/`
- `baseline/` — falhas e resumo da suíte ANTES da mudança (`frontend-fails.txt`, `backoffice-fails.txt`, `*-summary.txt`, `*-tsc.txt`).
- `evidence/` — screenshots e saídas de verificação (não comitar: `/docs/` é gitignored no frontend).
- `ledger.md` — decisões tomadas e itens adiados.

## Global Constraints

- Site, todos os critérios (`visitors`, `url`, `event`): `initialDays: 30`, `metaMinimumDays: 1`, `metaMaximumDays: 180`, `localValidationMaximumDays: 180`, `editable: "yes"`, `historicalFill: "available"`, `unit: "days"`, `observedAt: "2026-09-30"`.
- Instagram, todos os critérios (`all`, `engaged`, `profile_visit`, `messaged`, `saved`): `initialDays: 365`, `metaMinimumDays: 1`, `metaMaximumDays: 365`, `localValidationMaximumDays: 365`, `editable: "yes"`, `historicalFill: "available"`, `unit: "days"`, `observedAt: "2026-09-30"`.
- Frontend e backoffice usam exatamente os mesmos números e as mesmas mensagens.
- Issue do servidor, site: código `WEBSITE_PERIOD_OUT_OF_RANGE`, reason exata `O período do público do site deve ficar entre 1 e 180 dias.`
- Issue do servidor, Instagram: código `INSTAGRAM_PERIOD_OUT_OF_RANGE`, reason exata `O período do público do Instagram deve ficar entre 1 e 365 dias.`
- Exceção de preservação: edição com mesma origem, critério e dias do público atual é aceita mesmo fora do intervalo (servidor e cliente).
- NÃO mudar: `validateWebsiteAudienceSelection`, `validateInstagramAudienceSelection`, `rule.ts`/`compileAudienceRule`, o Mat/MCP (`agent/`), o painel pós-Revisar, a trava de "Eventos registrados", públicos de lista e semelhantes.
- A checagem antiga `*_PERIOD_EVIDENCE_REQUIRED` permanece no código.
- Ajuda sob o campo, site: `Entre 1 e 180 dias. Quem visitou o site nesse período entra no público, inclusive visitas anteriores à criação.`
- Ajuda sob o campo, Instagram: `Entre 1 e 365 dias. Quem interagiu com o perfil nesse período entra no público.`
- Orientação da API de fontes do site com Pixel ativo: `Há Pixel com atividade recebida. Em 'Eventos registrados' aparecem só os eventos que este Pixel já recebeu.`
- Erro de período no cliente: `O período deve ficar entre {min} e {max} dias para esta combinação.`
- Testes rodam com bun. Suíte completa do frontend: `POSTGRES_URL=postgres://postgres:referral@localhost:55452/referral_test bun test --timeout 30000` (a 55432 é de outro projeto; o container `audience-period-test-pg` está em 55452). Suíte completa do backoffice: `POSTGRES_URL=postgres://postgres:referral@localhost:55452/referral_test FRONTEND_ROOT=D:/automatize-marketing/automatize-frontend-audience-period bun test`.
- Nada de `mock.module` em módulo compartilhado; para a Meta use `installMetaFetchStub` (`tests/helpers/meta-fetch-stub.ts`). `mock.module("server-only", () => ({}))` é permitido (folha).
- Nunca clicar **Confirmar** nem enviar POST real à Meta. Nunca escrever em banco de produção.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca comitar na `main`.

## Review Focus

1. **Público existente com período acima do teto (ex.: site 400 dias criado no Gerenciador), editado sem mudar o período** → deve continuar salvável no servidor e no cliente. Testes: Task 1 e 2 (servidor + helper), Task 4 (backoffice), e a regra `keepsCurrentPeriod` nos editores (Tasks 3 e 5).
2. **Valores de borda (0, 1, 180, 181 no site; 365, 366 no Instagram)** → 1/180/365 aceitos; 0/181/366 recusados. Testes do helper nas Tasks 1, 2 e 4.
3. **Período fora do intervalo recusado sem nenhuma escrita na Meta** → a revisão devolve a issue e o stub não registra nenhum POST. Teste "rejects … before any write" nas Tasks 1, 2 e 4.
4. **Troca de período de um público existente para fora do intervalo** (30 → 200 no site) → recusada. Teste nas Tasks 1 e 4.
5. **Tela com a resposta do servidor sem `periodEvidence`** (cliente antigo, resposta parcial) → o editor cai nas constantes empacotadas e mostra 30/365. Verificado no agent-browser (Tasks 3 e 5), cujas simulações omitem `periodEvidence` de propósito.

---

### Task 1: Frontend — contrato de período do site e checagem no servidor

**Worktree:** frontend.

**Files:**
- Modify: `lib/meta-business/marketing/audiences/website.ts:87-114` (constante + helper novo)
- Modify: `lib/meta-business/marketing/audiences/website-operation.ts:6-22` (import) e `:142-147` (checagem)
- Modify: `tests/website-audience.test.ts:68-78` (substituir o teste "records unknown period evidence…")
- Create: `tests/website-audience-review.test.ts`

**Interfaces:**
- Produces: `export function websitePeriodOutOfRange(evidence: Pick<WebsitePeriodEvidence, "metaMinimumDays" | "metaMaximumDays">, days: number, keepsCurrentPeriod?: boolean): boolean` em `website.ts`, consumido pelo editor na Task 3.
- Produces: issue `WEBSITE_PERIOD_OUT_OF_RANGE` de `reviewWebsiteAudience`.

- [ ] **Step 1: Escrever os testes de contrato e do helper (falhando)**

Em `tests/website-audience.test.ts`, acrescente `websitePeriodOutOfRange` ao import de `../lib/meta-business/marketing/audiences/website` e SUBSTITUA o teste inteiro `test("records unknown period evidence per website criterion instead of inventing a default", …)` por:

```ts
test("records the documented Meta period contract for every website criterion", () => {
  for (const criterion of Object.keys(WEBSITE_PERIOD_EVIDENCE) as Array<keyof typeof WEBSITE_PERIOD_EVIDENCE>) {
    const evidence = WEBSITE_PERIOD_EVIDENCE[criterion];
    assert.equal(websitePeriodEvidenceStatus(criterion), "ready");
    assert.equal(evidence.initialDays, 30);
    assert.equal(evidence.metaMinimumDays, 1);
    assert.equal(evidence.metaMaximumDays, 180);
    assert.equal(evidence.localValidationMaximumDays, 180);
    assert.equal(evidence.editable, "yes");
    assert.equal(evidence.historicalFill, "available");
    assert.equal(evidence.unit, "days");
    assert.equal(evidence.observedAt, "2026-09-30");
    assert.match(evidence.source, /developers\.facebook\.com\/docs\/marketing-api\/audiences\/guides\/website-custom-audiences/);
  }
});

test("accepts website periods from 1 to 180 days and preserves an unchanged existing period", () => {
  const evidence = WEBSITE_PERIOD_EVIDENCE.visitors;
  assert.equal(websitePeriodOutOfRange(evidence, 1), false);
  assert.equal(websitePeriodOutOfRange(evidence, 30), false);
  assert.equal(websitePeriodOutOfRange(evidence, 180), false);
  assert.equal(websitePeriodOutOfRange(evidence, 0), true);
  assert.equal(websitePeriodOutOfRange(evidence, 181), true);
  assert.equal(websitePeriodOutOfRange(evidence, 400), true);
  assert.equal(websitePeriodOutOfRange(evidence, 400, true), false);
});
```

- [ ] **Step 2: Escrever os testes da revisão no servidor (falhando)**

Crie `tests/website-audience-review.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "bun:test";

import { ensureMetaTestEnv, installMetaFetchStub, type MetaRequest } from "./helpers/meta-fetch-stub";

mock.module("server-only", () => ({}));
ensureMetaTestEnv();

const DAY = 86_400;
const PIXEL = { id: "pixel-1", name: "Pixel da loja", lastFiredTime: "2026-09-29T12:00:00Z" };

function websiteRule(retentionDays: number) {
  return { inclusions: { operator: "or", rules: [{ event_sources: [{ id: "pixel-1", type: "pixel" }], retention_seconds: retentionDays * DAY, filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "PageView" }] } }] } };
}

function graph(existing?: { id: string; rule: unknown }) {
  return (request: MetaRequest) => {
    if (request.path.endsWith("/customaudiences")) return { body: { data: [] } };
    if (request.path.endsWith("/adsets")) return { body: { data: [] } };
    if (existing && request.path === existing.id) {
      return { body: { id: existing.id, account_id: "act_9301", name: "Visitantes antigos", rule: existing.rule, permission_for_actions: { can_edit: true } } };
    }
    throw new Error(`Unexpected Graph request: ${request.method} ${request.path}`);
  };
}

async function review(retentionDays: number, audienceId?: string) {
  const { reviewWebsiteAudience } = await import("../lib/meta-business/marketing/audiences/website-operation");
  return reviewWebsiteAudience({
    adAccountId: "9301",
    accessToken: "token",
    name: "Visitantes do site",
    selection: { pixelId: "pixel-1", criterion: "visitors", retentionDays },
    sources: [PIXEL],
    ...(audienceId ? { audienceId } : {}),
  });
}

test("website review accepts a new audience with the 30-day initial period", async () => {
  const stub = installMetaFetchStub(graph());
  try {
    const result = await review(30);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.after.retentionDays, 30);
    assert.equal(result.periodEvidence.metaMaximumDays, 180);
  } finally {
    stub.restore();
  }
});

test("website review accepts the 180-day maximum", async () => {
  const stub = installMetaFetchStub(graph());
  try {
    const result = await review(180);
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    stub.restore();
  }
});

test("website review rejects a new audience above 180 days before any write", async () => {
  const stub = installMetaFetchStub(graph());
  try {
    const result = await review(181);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues[0]?.code, "WEBSITE_PERIOD_OUT_OF_RANGE");
    assert.equal(result.issues[0]?.reason, "O período do público do site deve ficar entre 1 e 180 dias.");
    assert.equal(stub.calls.filter((call) => call.method !== "GET").length, 0);
  } finally {
    stub.restore();
  }
});

test("website review preserves an existing 400-day period when it is unchanged", async () => {
  const stub = installMetaFetchStub(graph({ id: "CA9301", rule: websiteRule(400) }));
  try {
    const result = await review(400, "CA9301");
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    stub.restore();
  }
});

test("website review rejects changing an existing audience to a period above 180 days", async () => {
  const stub = installMetaFetchStub(graph({ id: "CA9301", rule: websiteRule(30) }));
  try {
    const result = await review(200, "CA9301");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues[0]?.code, "WEBSITE_PERIOD_OUT_OF_RANGE");
  } finally {
    stub.restore();
  }
});
```

Se o handler lançar `Unexpected Graph request` para um caminho legítimo que a revisão usa (ex.: outro edge de leitura em `previewAudienceMetadataUpdate`), acrescente esse caminho ao handler devolvendo `{ data: [] }`. Não afrouxe as asserções.

- [ ] **Step 3: Rodar e ver falhar**

Run: `bun test tests/website-audience.test.ts tests/website-audience-review.test.ts`
Expected: FAIL. `websitePeriodOutOfRange` não existe, o status é `"blocked"` e a revisão devolve `WEBSITE_PERIOD_EVIDENCE_REQUIRED` em vez de `ok: true`.

- [ ] **Step 4: Implementar o contrato e o helper em `website.ts`**

Substitua o comentário e a constante (`/** The API/docs do not establish … */` até o fim de `WEBSITE_PERIOD_EVIDENCE`) por:

```ts
/**
 * Website period contract from Meta's official docs (checked 2026-09-30):
 * `retention_days` accepts 1–180 and `prefill` backfills at most 180 days.
 * The same page's FAQ mentions 365; 180 is valid under both readings. The
 * 30-day initial value is the official example and the Help Center's
 * retargeting window.
 */
export const WEBSITE_PERIOD_EVIDENCE: Record<WebsiteAudienceCriterion, WebsitePeriodEvidence> = Object.fromEntries(([
  "visitors", "url", "event",
] as WebsiteAudienceCriterion[]).map((criterion) => [criterion, {
  criterion,
  initialDays: 30,
  editable: "yes",
  metaMinimumDays: 1,
  metaMaximumDays: 180,
  localValidationMaximumDays: 180,
  unit: "days",
  historicalFill: "available",
  observedAt: "2026-09-30",
  context: "Limites da documentação oficial da Meta para públicos de site: retention_days entre 1 e 180 dias e prefill de até 180 dias. O FAQ da mesma página cita 365 dias; adotamos 180, válido nas duas leituras. Valor inicial de 30 dias: exemplo oficial e janela citada pela Central de Ajuda.",
  source: "https://developers.facebook.com/docs/marketing-api/audiences/guides/website-custom-audiences · https://www.facebook.com/business/help/610516375684216",
} satisfies WebsitePeriodEvidence])) as Record<WebsiteAudienceCriterion, WebsitePeriodEvidence>;
```

Logo depois de `websitePeriodEvidenceStatus`, acrescente:

```ts
/**
 * True when `days` breaks the Meta limits recorded in `evidence`. An existing
 * audience whose period did not change is accepted as-is: it may predate
 * these limits (created in Ads Manager) and must stay editable.
 */
export function websitePeriodOutOfRange(
  evidence: Pick<WebsitePeriodEvidence, "metaMinimumDays" | "metaMaximumDays">,
  days: number,
  keepsCurrentPeriod = false,
): boolean {
  if (keepsCurrentPeriod) return false;
  return (evidence.metaMinimumDays !== null && days < evidence.metaMinimumDays)
    || (evidence.metaMaximumDays !== null && days > evidence.metaMaximumDays);
}
```

- [ ] **Step 5: Implementar a checagem em `reviewWebsiteAudience`**

Em `website-operation.ts`, acrescente `websitePeriodOutOfRange,` ao import de `./website`. Logo DEPOIS do bloco `if (websitePeriodEvidenceStatus(...) !== "ready" && !websitePeriodSelectionsEqual(before, input.selection)) { … }` (mantenha-o), acrescente:

```ts
    if (websitePeriodOutOfRange(periodEvidence, input.selection.retentionDays, websitePeriodSelectionsEqual(before, input.selection))) {
      return { ok: false, issues: [issue("WEBSITE_PERIOD_OUT_OF_RANGE", `O período do público do site deve ficar entre ${periodEvidence.metaMinimumDays} e ${periodEvidence.metaMaximumDays} dias.`, "Ajuste o período e revise novamente.")] };
    }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `bun test tests/website-audience.test.ts tests/website-audience-review.test.ts`
Expected: PASS em todos.

- [ ] **Step 7: Commit**

```bash
git add lib/meta-business/marketing/audiences/website.ts lib/meta-business/marketing/audiences/website-operation.ts tests/website-audience.test.ts tests/website-audience-review.test.ts
git commit -m "fix(audiences): público de site usa os limites da Meta (1-180, inicial 30)

O registro de evidência ficou todo desconhecido desde o ticket-24 e
bloqueava todo público novo. A revisão passa a recusar período fora de
1-180, preservando o período inalterado de público existente.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Frontend — contrato de período do Instagram e checagem no servidor

**Worktree:** frontend.

**Files:**
- Modify: `lib/meta-business/marketing/audiences/instagram.ts:61-120` (constante + helper novo)
- Modify: `lib/meta-business/marketing/audiences/instagram-operation.ts:16-30` (import) e `:231-236` (checagem)
- Modify: `tests/instagram-audience.test.ts:50-61` (substituir "does not invent a period default…")
- Create: `tests/instagram-audience-review.test.ts`

**Interfaces:**
- Produces: `export function instagramPeriodOutOfRange(evidence: Pick<InstagramPeriodEvidence, "metaMinimumDays" | "metaMaximumDays">, days: number, keepsCurrentPeriod?: boolean): boolean` em `instagram.ts`, consumido pelo editor na Task 3.
- Produces: issue `INSTAGRAM_PERIOD_OUT_OF_RANGE` de `reviewInstagramAudience`.

- [ ] **Step 1: Escrever os testes de contrato e do helper (falhando)**

Em `tests/instagram-audience.test.ts`, acrescente `instagramPeriodOutOfRange` ao import de `../lib/meta-business/marketing/audiences/instagram` e SUBSTITUA o teste `test("does not invent a period default and records evidence independently for all criteria", …)` por:

```ts
test("records the documented Meta period contract for every Instagram criterion", () => {
  for (const criterion of Object.keys(INSTAGRAM_PERIOD_EVIDENCE) as Array<keyof typeof INSTAGRAM_PERIOD_EVIDENCE>) {
    const evidence = INSTAGRAM_PERIOD_EVIDENCE[criterion];
    assert.equal(instagramPeriodEvidenceStatus(criterion), "ready");
    assert.equal(evidence.initialDays, 365);
    assert.equal(evidence.metaMinimumDays, 1);
    assert.equal(evidence.metaMaximumDays, 365);
    assert.equal(evidence.localValidationMaximumDays, 365);
    assert.equal(evidence.editable, "yes");
    assert.equal(evidence.historicalFill, "available");
    assert.equal(evidence.unit, "days");
    assert.equal(evidence.observedAt, "2026-09-30");
    assert.match(evidence.source, /facebook\.com\/business\/help\/214981095688584/);
  }
  assert.throws(() => validateInstagramAudienceSelection({ profileId: "ig-1", criterion: "all", retentionDays: 0 }));
});

test("accepts Instagram periods from 1 to 365 days and preserves an unchanged existing period", () => {
  const evidence = INSTAGRAM_PERIOD_EVIDENCE.all;
  assert.equal(instagramPeriodOutOfRange(evidence, 1), false);
  assert.equal(instagramPeriodOutOfRange(evidence, 365), false);
  assert.equal(instagramPeriodOutOfRange(evidence, 0), true);
  assert.equal(instagramPeriodOutOfRange(evidence, 366), true);
  assert.equal(instagramPeriodOutOfRange(evidence, 400, true), false);
});
```

- [ ] **Step 2: Escrever os testes da revisão no servidor (falhando)**

Crie `tests/instagram-audience-review.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "bun:test";

import { ensureMetaTestEnv, installMetaFetchStub, type MetaRequest } from "./helpers/meta-fetch-stub";

mock.module("server-only", () => ({}));
ensureMetaTestEnv();

const DAY = 86_400;

function instagramRule(retentionDays: number) {
  return { inclusions: { operator: "or", rules: [{ event_sources: [{ id: "ig-1", type: "ig_business" }], retention_seconds: retentionDays * DAY, filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "ig_business_profile_all" }] } }] } };
}

function graph(existing?: { id: string; rule: unknown }) {
  return (request: MetaRequest) => {
    if (request.path.endsWith("/customaudiences")) return { body: { data: [] } };
    if (request.path.endsWith("/adsets")) return { body: { data: [] } };
    if (existing && request.path === existing.id) {
      return { body: { id: existing.id, account_id: "act_9302", name: "Engajamento antigo", rule: existing.rule, permission_for_actions: { can_edit: true } } };
    }
    throw new Error(`Unexpected Graph request: ${request.method} ${request.path}`);
  };
}

async function review(retentionDays: number, audienceId?: string) {
  const { reviewInstagramAudience } = await import("../lib/meta-business/marketing/audiences/instagram-operation");
  return reviewInstagramAudience({
    adAccountId: "9302",
    accessToken: "token",
    name: "Engajou no perfil",
    selection: { profileId: "ig-1", criterion: "all", retentionDays },
    profiles: [{ id: "ig-1" }],
    ...(audienceId ? { audienceId } : {}),
  });
}

test("instagram review accepts a new audience with the 365-day initial period", async () => {
  const stub = installMetaFetchStub(graph());
  try {
    const result = await review(365);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.after.retentionDays, 365);
    assert.equal(result.periodEvidence.metaMaximumDays, 365);
  } finally {
    stub.restore();
  }
});

test("instagram review rejects a new audience above 365 days before any write", async () => {
  const stub = installMetaFetchStub(graph());
  try {
    const result = await review(366);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues[0]?.code, "INSTAGRAM_PERIOD_OUT_OF_RANGE");
    assert.equal(result.issues[0]?.reason, "O período do público do Instagram deve ficar entre 1 e 365 dias.");
    assert.equal(stub.calls.filter((call) => call.method !== "GET").length, 0);
  } finally {
    stub.restore();
  }
});

test("instagram review preserves an existing 400-day period when it is unchanged", async () => {
  const stub = installMetaFetchStub(graph({ id: "CA9302", rule: instagramRule(400) }));
  try {
    const result = await review(400, "CA9302");
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    stub.restore();
  }
});
```

Se o tipo de `profiles` exigir mais campos que `id`, preencha o mínimo que o tipo `InstagramSourceProfile` pede. Mesma regra do Task 1 para caminhos legítimos do Graph no handler.

- [ ] **Step 3: Rodar e ver falhar**

Run: `bun test tests/instagram-audience.test.ts tests/instagram-audience-review.test.ts`
Expected: FAIL. `instagramPeriodOutOfRange` não existe, o status é `"blocked"` e a revisão devolve `INSTAGRAM_PERIOD_EVIDENCE_REQUIRED`.

- [ ] **Step 4: Implementar o contrato e o helper em `instagram.ts`**

Substitua o comentário `/** Periods are deliberately not defaulted. … */` e a constante `INSTAGRAM_PERIOD_EVIDENCE` por:

```ts
/**
 * Instagram account audience period from Meta's official docs (checked
 * 2026-09-30): the Help Center caps the Ads Manager retention at 365 days,
 * while the developer guide lists 730 for `ig_business`. 365 is valid under
 * both. Ads Manager's prefilled value is not documented; 365 is our choice
 * within that limit. Validation stays at 1–730 so older audiences still parse.
 */
export const INSTAGRAM_PERIOD_EVIDENCE: Record<InstagramAudienceCriterion, InstagramPeriodEvidence> =
  Object.fromEntries(
    (Object.keys(INSTAGRAM_AUDIENCE_CRITERIA) as InstagramAudienceCriterion[]).map(
      (criterion) => [criterion, {
        criterion,
        initialDays: 365,
        editable: "yes",
        metaMinimumDays: 1,
        metaMaximumDays: 365,
        localValidationMaximumDays: 365,
        unit: "days",
        historicalFill: "available",
        observedAt: "2026-09-30",
        context: "A Central de Ajuda da Meta limita o período do público da conta do Instagram a 365 dias; a documentação de desenvolvedor lista 730. Adotamos 365, válido nas duas fontes. O valor pré-preenchido pelo Gerenciador não é documentado: 365 é escolha de produto dentro do limite.",
        source: "https://www.facebook.com/business/help/214981095688584 · https://developers.facebook.com/docs/marketing-api/audiences/guides/engagement-custom-audiences",
      } satisfies InstagramPeriodEvidence],
    ),
  ) as Record<InstagramAudienceCriterion, InstagramPeriodEvidence>;
```

Logo depois de `instagramPeriodEvidenceStatus`, acrescente:

```ts
/**
 * True when `days` breaks the Meta limits recorded in `evidence`. An existing
 * audience whose period did not change is accepted as-is: it may predate
 * these limits and must stay editable.
 */
export function instagramPeriodOutOfRange(
  evidence: Pick<InstagramPeriodEvidence, "metaMinimumDays" | "metaMaximumDays">,
  days: number,
  keepsCurrentPeriod = false,
): boolean {
  if (keepsCurrentPeriod) return false;
  return (evidence.metaMinimumDays !== null && days < evidence.metaMinimumDays)
    || (evidence.metaMaximumDays !== null && days > evidence.metaMaximumDays);
}
```

- [ ] **Step 5: Implementar a checagem em `reviewInstagramAudience`**

Em `instagram-operation.ts`, acrescente `instagramPeriodOutOfRange,` ao import de `./instagram`. Logo DEPOIS do bloco `if (instagramPeriodEvidenceStatus(...) !== "ready" && !selectionEqual(before, input.selection)) { … }` (mantenha-o), acrescente:

```ts
    if (instagramPeriodOutOfRange(periodEvidence, input.selection.retentionDays, selectionEqual(before, input.selection))) {
      return { ok: false, issues: [issue("INSTAGRAM_PERIOD_OUT_OF_RANGE", `O período do público do Instagram deve ficar entre ${periodEvidence.metaMinimumDays} e ${periodEvidence.metaMaximumDays} dias.`, "Ajuste o período e revise novamente.")] };
    }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `bun test tests/instagram-audience.test.ts tests/instagram-audience-review.test.ts`
Expected: PASS em todos.

- [ ] **Step 7: Commit**

```bash
git add lib/meta-business/marketing/audiences/instagram.ts lib/meta-business/marketing/audiences/instagram-operation.ts tests/instagram-audience.test.ts tests/instagram-audience-review.test.ts
git commit -m "fix(audiences): público do Instagram usa os limites da Meta (1-365, inicial 365)

Mesmo bloqueio do público de site: evidência toda desconhecida desde o
ticket-24. A revisão passa a recusar período fora de 1-365, preservando
o período inalterado de público existente.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — tela dos editores, orientação da API e verificação no navegador

**Worktree:** frontend.

**Files:**
- Modify: `app/app/(main)/marketing/audiences/website-audience-editor.tsx` (import linha 6, checagens linhas 59-60, JSX linha 75)
- Modify: `app/app/(main)/marketing/audiences/instagram-audience-editor.tsx` (import linhas 6-14, checagens linhas 120-127, JSX linhas 176 e 178)
- Modify: `app/api/meta-business/marketing/[accountId]/audiences/route.ts:142-143` (orientação)
- Create: `tests/audience-period-copy.test.ts`

**Interfaces:**
- Consumes: `websitePeriodOutOfRange` (Task 1) e `instagramPeriodOutOfRange` (Task 2), mesmas assinaturas.

- [ ] **Step 1: Escrever o teste de texto (falhando)**

Crie `tests/audience-period-copy.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("audience editors explain the period in plain language instead of internal evidence fields", () => {
  const website = read("app/app/(main)/marketing/audiences/website-audience-editor.tsx");
  const instagram = read("app/app/(main)/marketing/audiences/instagram-audience-editor.tsx");
  for (const source of [website, instagram]) {
    for (const jargon of ["Unidade enviada", "Limite local", "Limites Meta:", "Preenchimento histórico:", "Valor inicial:"]) {
      assert.equal(source.includes(jargon), false, `jargão "${jargon}" ainda aparece no editor`);
    }
  }
  assert.equal(website.includes("são fatos diferentes"), false);
  assert.ok(website.includes("Quem visitou o site nesse período entra no público, inclusive visitas anteriores à criação."));
  assert.ok(instagram.includes("Quem interagiu com o perfil nesse período entra no público."));
});

test("website sources guidance no longer claims periods are blocked", () => {
  const route = read("app/api/meta-business/marketing/[accountId]/audiences/route.ts");
  assert.equal(route.includes("os períodos permanecem impedidos"), false);
  assert.ok(route.includes("Há Pixel com atividade recebida. Em 'Eventos registrados' aparecem só os eventos que este Pixel já recebeu."));
});
```

Run: `bun test tests/audience-period-copy.test.ts`
Expected: FAIL (jargão presente, frases novas ausentes).

- [ ] **Step 2: Editor do site**

Em `website-audience-editor.tsx`:

1. Import da linha 6: acrescente `websitePeriodOutOfRange` à lista importada de `@/lib/meta-business/marketing/audiences/website`.
2. Substitua as DUAS linhas de checagem de mínimo/máximo (`if (periodReady && evidence.metaMinimumDays !== null && days < …` e `if (periodReady && evidence.metaMaximumDays !== null && days > …`) por:

```ts
    const keepsCurrentPeriod = isCurrentPeriod && current?.retentionDays === days;
    if (periodReady && websitePeriodOutOfRange(evidence, days, keepsCurrentPeriod)) { setError(`O período deve ficar entre ${evidence.metaMinimumDays} e ${evidence.metaMaximumDays} dias para esta combinação.`); return; }
```

3. No JSX (linha 75), dentro do `<label>` do ramo `periodReady`, logo depois do `<Input … onChange={(event) => setRetentionDays(event.target.value)} />` e antes de `</label>`, acrescente:

```tsx
<span className="mt-1 block text-xs text-muted-foreground">Entre {evidence.metaMinimumDays} e {evidence.metaMaximumDays} dias. Quem visitou o site nesse período entra no público, inclusive visitas anteriores à criação.</span>
```

4. Remova do JSX, por inteiro:
   - o parágrafo `<p className="mt-3 text-xs text-muted-foreground">A fonte acessível, a atividade recebida e o estado do público são fatos diferentes. … ele não é inventado nem truncado.</p>`;
   - o bloco `<dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">…</dl>` (Valor inicial / Editável / Limites Meta / Limite local / Unidade enviada / Preenchimento histórico).

   Não mexa no resto (avisos `role="alert"`, status de período preservado, linha "Fonte: …", painel de revisão).

- [ ] **Step 3: Editor do Instagram**

Em `instagram-audience-editor.tsx`:

1. Acrescente `instagramPeriodOutOfRange,` ao import de `@/lib/meta-business/marketing/audiences/instagram`.
2. Substitua os dois blocos de checagem (`if (periodReady && periodEvidence.metaMinimumDays !== null && days < …) { … }` e `if (periodReady && periodEvidence.metaMaximumDays !== null && days > …) { … }`) por:

```ts
    const keepsCurrentPeriod = isCurrentPeriod && parsed?.retentionDays === days;
    if (periodReady && instagramPeriodOutOfRange(periodEvidence, days, keepsCurrentPeriod)) {
      setError(`O período deve ficar entre ${periodEvidence.metaMinimumDays} e ${periodEvidence.metaMaximumDays} dias para esta combinação.`);
      return;
    }
```

3. Na linha 176, dentro do `<label>` do ramo `periodReady`, logo depois do `<Input … onChange={(event) => setRetentionDays(event.target.value)} />`, acrescente:

```tsx
<span className="mt-1 block text-xs text-muted-foreground">Entre {periodEvidence.metaMinimumDays} e {periodEvidence.metaMaximumDays} dias. Quem interagiu com o perfil nesse período entra no público.</span>
```

4. Remova a linha 178 inteira: `<dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">…</dl>`.

- [ ] **Step 4: Orientação da API de fontes do site**

Em `app/api/meta-business/marketing/[accountId]/audiences/route.ts`, troque a string da orientação com Pixel ativo:

```ts
          ? "Há Pixel com atividade recebida. Em 'Eventos registrados' aparecem só os eventos que este Pixel já recebeu."
```

(substitui `"Há Pixel acessível com atividade observada. Os eventos listados foram observados nos stats WEB_ONLY da própria fonte; os períodos permanecem impedidos enquanto a evidência por critério não estiver fechada."`). A mensagem sem Pixel ativo não muda.

- [ ] **Step 5: Rodar os testes e o tsc**

Run: `bun test tests/audience-period-copy.test.ts tests/website-audience.test.ts tests/instagram-audience.test.ts tests/audience-client-imports.test.ts`
Expected: PASS.

Run: `bunx tsc --noEmit -p . 2>&1 | grep -E "audiences/(website|instagram)-audience-editor|audiences/route.ts|audiences/(website|instagram)(-operation)?\.ts"`
Expected: nenhuma linha (sem erro de tipo nos arquivos tocados; a base tem erros alheios em `docs/superpowers/plans/2026-09-30-audience-period-unblock/baseline/frontend-tsc.txt`).

- [ ] **Step 6: Commit do código**

```bash
git add "app/app/(main)/marketing/audiences/website-audience-editor.tsx" "app/app/(main)/marketing/audiences/instagram-audience-editor.tsx" "app/api/meta-business/marketing/[accountId]/audiences/route.ts" tests/audience-period-copy.test.ts
git commit -m "fix(audiences): campo de período aparece com ajuda simples, sem jargão

Editores de site e Instagram mostram o período (30/365) com a faixa
permitida, sem a grade técnica de evidência. A orientação de fontes do
site para de dizer que o período está impedido.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Verificação no navegador com agent-browser (app rodando)**

Evidências em `D:/automatize-marketing/automatize-frontend-audience-period/docs/superpowers/plans/2026-09-30-audience-period-unblock/evidence/`. Rode `agent-browser --help` antes para confirmar a sintaxe de `open`, `network route`, `network requests`, `fill`, `click`, `eval` e `screenshot` nesta versão (0.38.1).

1. **Sessão sem login Google:** na worktree, `bun run impersonate:user:staging -- --user <email>` com uma conta do time em `SIMULATION_ALLOWED_EMAILS` (`lib/dev/customer-state-simulation.ts`) que, na staging, tenha onboarding concluído e acesso válido. Isso grava `.env.impersonation.local` (gitignored). Não altere dados de nenhum usuário. Se nenhuma conta servir sem escrita, PARE e reporte BLOCKED.
2. **Subir o app** (porta livre, ex.: 3217), em segundo plano: `DISABLE_EVE=true DISABLE_WORKFLOW=true APP_ENV=staging bun scripts/with-env.ts bun node_modules/next/dist/bin/next dev --webpack -p 3217`. Turbopack quebra no Windows; use `--webpack`.
3. **Simular só o que depende da Meta**, com `agent-browser network route` (HTTP 200), ANTES de abrir a página. Leia os tipos em `app/app/(main)/marketing/hooks/use-marketing-me.ts`, `audience-library-manager.tsx` e `customer-list-import.tsx` para montar corpos válidos de:
   - `GET /api/meta-business/marketing/me` (uma conta de anúncios `act_9301`, conexão saudável);
   - `GET /api/meta-business/marketing/9301/audiences?…` da biblioteca (lista vazia);
   - `GET /api/meta-business/marketing/9301/audiences/customer-file`;
   - `GET …/audiences?sources=website` com exatamente:
     `{"sources":[{"id":"pixel-1","name":"Pixel da loja","lastFiredTime":"2026-09-29T12:00:00Z","source":{"access":"available","activity":"available","availability":"unknown","observedEvents":["Purchase"],"observedEventsStatus":"available","guidance":"x"}}],"guidance":"Há Pixel com atividade recebida. Em 'Eventos registrados' aparecem só os eventos que este Pixel já recebeu."}` (SEM `periodEvidence`);
   - `GET …/audiences?sources=instagram` com `{"profiles":[{"id":"ig-1","username":"loja","source":{"access":"available","activity":"unknown","availability":"unknown","guidance":"x"}}]}` (SEM `periodEvidenceByProfile`);
   - `POST …/9301/audiences` (revisão) com um corpo `Review` válido do site: `ok: true`, `before: null`, `after: {pixelId:"pixel-1",criterion:"visitors",retentionDays:30}`, `source` igual ao do Pixel, `periodEvidence: {initialDays:30, metaMaximumDays:180, historicalFill:"available"}`, `impact: {knownUses:[], limitations:[]}`, `confirmationToken:"t"`, `commandId:"t"`, `notice:"ok"`.
4. Abra `http://localhost:3217/app/marketing/audiences`, entre em **Criar público → Site** e salve:
   - `frontend-site-30-revisar.png`: campo "Período de participação (dias)" = 30, linha de ajuda visível, **Revisar** habilitado. Confirme por `eval` que o input vale `"30"` e o botão não está `disabled`.
   - `frontend-site-181-erro.png`: preencha nome, mude o período para 181 e clique **Revisar**. O texto `O período deve ficar entre 1 e 180 dias para esta combinação.` aparece. Confirme por `network requests` que NENHUM POST saiu.
   - `frontend-site-revisao.png`: volte para 30 e clique **Revisar**. O painel "Revisão pronta para confirmação" aparece. Confirme por `network requests` que o corpo do POST tem `"retentionDays":30`. **Não clique Confirmar.**
5. Volte e entre em **Criar público → Instagram**. Salve `frontend-instagram-365.png`: período = 365, ajuda "Entre 1 e 365 dias…", **Revisar** habilitado.
6. Por `eval` na página do site e na do Instagram: `document.body.innerText` NÃO contém `Unidade enviada`, `Limite local`, `fatos diferentes` nem `impedid`. Salve a saída em `evidence/frontend-text-checks.txt`.
7. Pare o dev server e apague `.env.impersonation.local` (`bun run impersonate:user -- --env staging --clear`).

Se alguma etapa falhar por ambiente (login, porta, simulação), registre o motivo exato no relatório e em `docs/superpowers/plans/2026-09-30-audience-period-unblock/ledger.md`. Não declare a verificação feita sem os screenshots.

---

### Task 4: Backoffice — contrato de período e checagem no servidor (site e Instagram)

**Worktree:** backoffice. O código daqui é independente do frontend (não é espelho; não rode `sync:meta`). Mantenha o estilo compacto do arquivo (várias declarações por linha) quando ele for assim.

**Files:**
- Modify: `lib/meta-business/marketing/audiences/website.ts:16-22` (constante + helper)
- Modify: `lib/meta-business/marketing/audiences/instagram.ts:33-58` (constante + helper)
- Modify: `lib/meta-business/marketing/audiences/website-operation.ts:6` (import) e `:64` (checagem)
- Modify: `lib/meta-business/marketing/audiences/instagram-operation.ts:6` (import) e `:93` (checagem)
- Modify: `tests/website-audience.test.ts:47-53` ("keeps every website period criterion blocked…")
- Modify: `tests/instagram-audience.test.ts:14-23` ("records unknown period evidence instead of inventing a default")
- Create: `tests/audience-period-review.test.ts`

**Interfaces:**
- Produces: `websitePeriodOutOfRange` e `instagramPeriodOutOfRange` com as MESMAS assinaturas das Tasks 1 e 2, consumidos pelos editores do backoffice na Task 5.

- [ ] **Step 1: Testes de contrato e helper (falhando)**

`tests/website-audience.test.ts`: acrescente `websitePeriodOutOfRange` ao import e SUBSTITUA `test("keeps every website period criterion blocked until its evidence is closed", …)` por:

```ts
test("records the documented Meta period contract for every website criterion", () => {
  for (const evidence of Object.values(WEBSITE_PERIOD_EVIDENCE)) {
    assert.equal(websitePeriodEvidenceStatus(evidence.criterion), "ready");
    assert.equal(evidence.initialDays, 30);
    assert.equal(evidence.metaMinimumDays, 1);
    assert.equal(evidence.metaMaximumDays, 180);
    assert.equal(evidence.localValidationMaximumDays, 180);
    assert.equal(evidence.editable, "yes");
    assert.equal(evidence.historicalFill, "available");
    assert.equal(evidence.observedAt, "2026-09-30");
  }
  const visitors = WEBSITE_PERIOD_EVIDENCE.visitors;
  assert.equal(websitePeriodOutOfRange(visitors, 1), false);
  assert.equal(websitePeriodOutOfRange(visitors, 180), false);
  assert.equal(websitePeriodOutOfRange(visitors, 0), true);
  assert.equal(websitePeriodOutOfRange(visitors, 181), true);
  assert.equal(websitePeriodOutOfRange(visitors, 400, true), false);
});
```

`tests/instagram-audience.test.ts`: acrescente `instagramPeriodOutOfRange` ao import e SUBSTITUA `test("records unknown period evidence instead of inventing a default", …)` por:

```ts
test("records the documented Meta period contract for every Instagram criterion", () => {
  for (const evidence of Object.values(INSTAGRAM_PERIOD_EVIDENCE)) {
    assert.equal(instagramPeriodEvidenceStatus(evidence.criterion), "ready");
    assert.equal(evidence.initialDays, 365);
    assert.equal(evidence.metaMinimumDays, 1);
    assert.equal(evidence.metaMaximumDays, 365);
    assert.equal(evidence.localValidationMaximumDays, 365);
    assert.equal(evidence.editable, "yes");
    assert.equal(evidence.historicalFill, "available");
    assert.equal(evidence.unit, "days");
    assert.equal(evidence.observedAt, "2026-09-30");
  }
  assert.throws(() => validateInstagramAudienceSelection({ profileId: "ig-1", criterion: "all", retentionDays: 0 }));
  const all = INSTAGRAM_PERIOD_EVIDENCE.all;
  assert.equal(instagramPeriodOutOfRange(all, 365), false);
  assert.equal(instagramPeriodOutOfRange(all, 366), true);
  assert.equal(instagramPeriodOutOfRange(all, 400, true), false);
});
```

- [ ] **Step 2: Testes da revisão no servidor (falhando)**

Crie `tests/audience-period-review.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "bun:test";

import { ensureMetaTestEnv, installMetaFetchStub, type MetaRequest } from "./helpers/meta-fetch-stub";

mock.module("server-only", () => ({}));
ensureMetaTestEnv();

const DAY = 86_400;

function rule(source: { id: string; type: "pixel" | "ig_business" }, event: string, retentionDays: number) {
  return { inclusions: { operator: "or", rules: [{ event_sources: [source], retention_seconds: retentionDays * DAY, filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: event }] } }] } };
}

function graph(existing?: { id: string; rule: unknown }) {
  return (request: MetaRequest) => {
    if (request.path.endsWith("/customaudiences")) return { body: { data: [] } };
    if (request.path.endsWith("/adsets")) return { body: { data: [] } };
    if (existing && request.path === existing.id) {
      return { body: { id: existing.id, account_id: "act_9303", name: "Público antigo", rule: existing.rule, permission_for_actions: { can_edit: true } } };
    }
    throw new Error(`Unexpected Graph request: ${request.method} ${request.path}`);
  };
}

async function reviewWebsite(retentionDays: number, audienceId?: string) {
  const { reviewWebsiteAudience } = await import("../lib/meta-business/marketing/audiences/website-operation");
  return reviewWebsiteAudience({ adAccountId: "9303", accessToken: "token", name: "Visitantes do site", selection: { pixelId: "pixel-1", criterion: "visitors", retentionDays }, sources: [{ id: "pixel-1", name: "Pixel", lastFiredTime: "2026-09-29T12:00:00Z" }], ...(audienceId ? { audienceId } : {}) });
}

async function reviewInstagram(retentionDays: number, audienceId?: string) {
  const { reviewInstagramAudience } = await import("../lib/meta-business/marketing/audiences/instagram-operation");
  return reviewInstagramAudience({ adAccountId: "9303", accessToken: "token", name: "Engajou no perfil", selection: { profileId: "ig-1", criterion: "all", retentionDays }, profiles: [{ id: "ig-1" }], ...(audienceId ? { audienceId } : {}) });
}

test("backoffice website review accepts 30 days and rejects 181 days before any write", async () => {
  const stub = installMetaFetchStub(graph());
  try {
    const accepted = await reviewWebsite(30);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const rejected = await reviewWebsite(181);
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.issues[0]?.code, "WEBSITE_PERIOD_OUT_OF_RANGE");
    assert.equal(rejected.issues[0]?.reason, "O período do público do site deve ficar entre 1 e 180 dias.");
    assert.equal(stub.calls.filter((call) => call.method !== "GET").length, 0);
  } finally {
    stub.restore();
  }
});

test("backoffice website review preserves an unchanged 400-day period and rejects a change to 200", async () => {
  const unchanged = installMetaFetchStub(graph({ id: "CA9303", rule: rule({ id: "pixel-1", type: "pixel" }, "PageView", 400) }));
  try {
    const result = await reviewWebsite(400, "CA9303");
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    unchanged.restore();
  }
  const changed = installMetaFetchStub(graph({ id: "CA9303", rule: rule({ id: "pixel-1", type: "pixel" }, "PageView", 30) }));
  try {
    const result = await reviewWebsite(200, "CA9303");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues[0]?.code, "WEBSITE_PERIOD_OUT_OF_RANGE");
  } finally {
    changed.restore();
  }
});

test("backoffice instagram review accepts 365 days, rejects 366 and preserves an unchanged 400-day period", async () => {
  const fresh = installMetaFetchStub(graph());
  try {
    const accepted = await reviewInstagram(365);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const rejected = await reviewInstagram(366);
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.issues[0]?.code, "INSTAGRAM_PERIOD_OUT_OF_RANGE");
    assert.equal(rejected.issues[0]?.reason, "O período do público do Instagram deve ficar entre 1 e 365 dias.");
    assert.equal(fresh.calls.filter((call) => call.method !== "GET").length, 0);
  } finally {
    fresh.restore();
  }
  const existing = installMetaFetchStub(graph({ id: "CA9304", rule: rule({ id: "ig-1", type: "ig_business" }, "ig_business_profile_all", 400) }));
  try {
    const result = await reviewInstagram(400, "CA9304");
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    existing.restore();
  }
});
```

Mesma regra das Tasks 1/2 sobre caminhos legítimos do Graph e campos mínimos de `profiles`/`sources`.

Run: `bun test tests/website-audience.test.ts tests/instagram-audience.test.ts tests/audience-period-review.test.ts`
Expected: FAIL (helpers ausentes, status `"blocked"`, `*_PERIOD_EVIDENCE_REQUIRED`).

- [ ] **Step 3: Implementar em `website.ts` e `instagram.ts` do backoffice**

Em `website.ts`, troque os valores do objeto dentro de `WEBSITE_PERIOD_EVIDENCE` para (mantendo `sourceId: undefined, criterion`):

```ts
initialDays: 30, editable: "yes", metaMinimumDays: 1, metaMaximumDays: 180, localValidationMaximumDays: 180, unit: "days", historicalFill: "available", observedAt: "2026-09-30", context: "Limites da documentação oficial da Meta para públicos de site: retention_days entre 1 e 180 dias e prefill de até 180 dias. O FAQ da mesma página cita 365 dias; adotamos 180, válido nas duas leituras. Valor inicial de 30 dias: exemplo oficial e janela citada pela Central de Ajuda.", source: "https://developers.facebook.com/docs/marketing-api/audiences/guides/website-custom-audiences · https://www.facebook.com/business/help/610516375684216"
```

e, depois de `websitePeriodEvidenceStatus`, acrescente:

```ts
/** True when `days` breaks the Meta limits in `evidence`; an unchanged existing period is accepted as-is. */
export function websitePeriodOutOfRange(evidence: Pick<WebsitePeriodEvidence, "metaMinimumDays" | "metaMaximumDays">, days: number, keepsCurrentPeriod = false): boolean { if (keepsCurrentPeriod) return false; return (evidence.metaMinimumDays !== null && days < evidence.metaMinimumDays) || (evidence.metaMaximumDays !== null && days > evidence.metaMaximumDays); }
```

Em `instagram.ts`, troque o comentário `/** No default is safe here: … */` por `/** Instagram account audience period from Meta's official docs (2026-09-30): Help Center caps it at 365; the developer guide lists 730. 365 is valid under both. */` e os valores para:

```ts
    initialDays: 365,
    editable: "yes",
    metaMinimumDays: 1,
    metaMaximumDays: 365,
    localValidationMaximumDays: 365,
    unit: "days",
    historicalFill: "available",
    observedAt: "2026-09-30",
    context: "A Central de Ajuda da Meta limita o período do público da conta do Instagram a 365 dias; a documentação de desenvolvedor lista 730. Adotamos 365, válido nas duas fontes. O valor pré-preenchido pelo Gerenciador não é documentado: 365 é escolha de produto dentro do limite.",
    source: "https://www.facebook.com/business/help/214981095688584 · https://developers.facebook.com/docs/marketing-api/audiences/guides/engagement-custom-audiences",
```

e, depois de `instagramPeriodEvidenceStatus`, acrescente:

```ts
/** True when `days` breaks the Meta limits in `evidence`; an unchanged existing period is accepted as-is. */
export function instagramPeriodOutOfRange(evidence: Pick<InstagramPeriodEvidence, "metaMinimumDays" | "metaMaximumDays">, days: number, keepsCurrentPeriod = false): boolean {
  if (keepsCurrentPeriod) return false;
  return (evidence.metaMinimumDays !== null && days < evidence.metaMinimumDays) || (evidence.metaMaximumDays !== null && days > evidence.metaMaximumDays);
}
```

- [ ] **Step 4: Implementar as checagens no servidor do backoffice**

`website-operation.ts`: acrescente `websitePeriodOutOfRange` ao import da linha 6 e, na linha logo depois do `if (websitePeriodEvidenceStatus(...) … WEBSITE_PERIOD_EVIDENCE_REQUIRED …)` (linha 64, mantenha-a), acrescente:

```ts
    if (websitePeriodOutOfRange(periodEvidence, input.selection.retentionDays, websitePeriodSelectionsEqual(before, input.selection))) return { ok: false, issues: [issue("WEBSITE_PERIOD_OUT_OF_RANGE", `O período do público do site deve ficar entre ${periodEvidence.metaMinimumDays} e ${periodEvidence.metaMaximumDays} dias.`, "Ajuste o período e revise novamente.")] };
```

`instagram-operation.ts`: acrescente `instagramPeriodOutOfRange` ao import da linha 6 e, logo depois da linha 93 (`… INSTAGRAM_PERIOD_EVIDENCE_REQUIRED …`, mantenha-a), acrescente:

```ts
    if (instagramPeriodOutOfRange(periodEvidence, input.selection.retentionDays, sameSelection(before, input.selection))) return { ok: false, issues: [issue("INSTAGRAM_PERIOD_OUT_OF_RANGE", `O período do público do Instagram deve ficar entre ${periodEvidence.metaMinimumDays} e ${periodEvidence.metaMaximumDays} dias.`, "Ajuste o período e revise novamente.")] };
```

- [ ] **Step 5: Rodar e ver passar**

Run: `bun test tests/website-audience.test.ts tests/instagram-audience.test.ts tests/audience-period-review.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/meta-business/marketing/audiences/website.ts lib/meta-business/marketing/audiences/instagram.ts lib/meta-business/marketing/audiences/website-operation.ts lib/meta-business/marketing/audiences/instagram-operation.ts tests/website-audience.test.ts tests/instagram-audience.test.ts tests/audience-period-review.test.ts
git commit -m "fix(audiences): backoffice usa os limites da Meta em site (1-180) e Instagram (1-365)

Mesmo bloqueio do frontend (ticket-24, fd30325): evidência toda
desconhecida impedia criar público. Valores e mensagens idênticos aos
do frontend; período inalterado de público existente é preservado.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Backoffice — tela dos editores, orientação da API e verificação no navegador

**Worktree:** backoffice.

**Files:**
- Modify: `app/(admin)/marketing/audiences/website-audience-editor.tsx` (import linha 6, checagens linhas 58-59, JSX linha 74)
- Modify: `app/(admin)/marketing/audiences/instagram-audience-editor.tsx` (import, checagens ~linhas 106-113, JSX linhas 161 e 163)
- Modify: `app/api/meta-marketing/[accountId]/audiences/route.ts:123` (orientação)
- Create: `tests/audience-period-copy.test.ts`

**Interfaces:**
- Consumes: `websitePeriodOutOfRange` e `instagramPeriodOutOfRange` do backoffice (Task 4).

- [ ] **Step 1: Teste de texto (falhando)**

Crie `tests/audience-period-copy.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("backoffice audience editors explain the period in plain language instead of internal evidence fields", () => {
  const website = read("app/(admin)/marketing/audiences/website-audience-editor.tsx");
  const instagram = read("app/(admin)/marketing/audiences/instagram-audience-editor.tsx");
  for (const source of [website, instagram]) {
    for (const jargon of ["Unidade enviada", "Limite local", "Limites Meta:", "Preenchimento histórico:", "Valor inicial:"]) {
      assert.equal(source.includes(jargon), false, `jargão "${jargon}" ainda aparece no editor`);
    }
  }
  assert.equal(website.includes("são fatos distintos"), false);
  assert.ok(website.includes("Quem visitou o site nesse período entra no público, inclusive visitas anteriores à criação."));
  assert.ok(instagram.includes("Quem interagiu com o perfil nesse período entra no público."));
});

test("backoffice website sources guidance no longer claims periods are blocked", () => {
  const route = read("app/api/meta-marketing/[accountId]/audiences/route.ts");
  assert.equal(route.includes("os períodos permanecem impedidos"), false);
  assert.ok(route.includes("Há Pixel com atividade recebida. Em 'Eventos registrados' aparecem só os eventos que este Pixel já recebeu."));
});
```

Run: `bun test tests/audience-period-copy.test.ts`
Expected: FAIL.

- [ ] **Step 2: Editor do site (backoffice)**

Em `app/(admin)/marketing/audiences/website-audience-editor.tsx`:

1. Acrescente `websitePeriodOutOfRange` ao import da linha 6.
2. Substitua as linhas 58-59 (checagens de mínimo e máximo) por:

```ts
    const keepsCurrentPeriod = isCurrentPeriod && current?.retentionDays === days;
    if (periodReady && websitePeriodOutOfRange(evidence, days, keepsCurrentPeriod)) { setError(`O período deve ficar entre ${evidence.metaMinimumDays} e ${evidence.metaMaximumDays} dias para esta combinação.`); return; }
```

3. No JSX (linha 74), dentro do `<label>` do ramo `periodReady`, depois do `<Input … onChange={(event) => setRetentionDays(event.target.value)} />`, acrescente:

```tsx
<span className="mt-1 block text-xs text-muted-foreground">Entre {evidence.metaMinimumDays} e {evidence.metaMaximumDays} dias. Quem visitou o site nesse período entra no público, inclusive visitas anteriores à criação.</span>
```

4. Remova por inteiro: o parágrafo `<p className="mt-3 text-xs text-muted-foreground">Fonte, atividade e disponibilidade são fatos distintos. … ele não é inventado nem truncado.</p>` e o bloco `<dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground md:grid-cols-2">…</dl>`.

- [ ] **Step 3: Editor do Instagram (backoffice)**

Em `app/(admin)/marketing/audiences/instagram-audience-editor.tsx`:

1. Acrescente `instagramPeriodOutOfRange` ao import de `@/lib/meta-business/marketing/audiences/instagram`.
2. Substitua os blocos de checagem de mínimo e máximo (`if (periodReady && periodEvidence.metaMinimumDays !== null && days < …` e `if (periodReady && periodEvidence.metaMaximumDays !== null && days > …`, por volta das linhas 106-113) por:

```ts
    const keepsCurrentPeriod = isCurrentPeriod && parsed?.retentionDays === days;
    if (periodReady && instagramPeriodOutOfRange(periodEvidence, days, keepsCurrentPeriod)) {
      setError(`O período deve ficar entre ${periodEvidence.metaMinimumDays} e ${periodEvidence.metaMaximumDays} dias para esta combinação.`);
      return;
    }
```

   Se a variável do público parseado tiver outro nome neste arquivo, use o nome real (é a mesma que alimenta `isCurrentPeriod`).
3. Linha 161: dentro do `<label>` do ramo `periodReady`, depois do `<Input … />`, acrescente:

```tsx
<span className="mt-1 block text-xs text-muted-foreground">Entre {periodEvidence.metaMinimumDays} e {periodEvidence.metaMaximumDays} dias. Quem interagiu com o perfil nesse período entra no público.</span>
```

4. Remova a linha 163 inteira (`<dl …>…</dl>`).

- [ ] **Step 4: Orientação da API de fontes do site (backoffice)**

Em `app/api/meta-marketing/[accountId]/audiences/route.ts:123`, troque `"Há Pixel acessível com atividade observada. Os eventos listados foram observados nos stats WEB_ONLY da própria fonte; os períodos permanecem impedidos enquanto a evidência por critério não estiver fechada."` por `"Há Pixel com atividade recebida. Em 'Eventos registrados' aparecem só os eventos que este Pixel já recebeu."`.

- [ ] **Step 5: Rodar testes, tsc e lint por arquivo**

Run: `bun test tests/audience-period-copy.test.ts tests/website-audience.test.ts tests/instagram-audience.test.ts tests/audience-library-manager.test.ts`
Expected: PASS.

Run: `bunx tsc --noEmit -p . 2>&1 | grep -E "audiences/(website|instagram)-audience-editor|audiences/route.ts|audiences/(website|instagram)(-operation)?\.ts"`
Expected: nenhuma linha.

Run: `bunx eslint "app/(admin)/marketing/audiences/website-audience-editor.tsx" "app/(admin)/marketing/audiences/instagram-audience-editor.tsx" "app/api/meta-marketing/[accountId]/audiences/route.ts" lib/meta-business/marketing/audiences/website.ts lib/meta-business/marketing/audiences/instagram.ts lib/meta-business/marketing/audiences/website-operation.ts lib/meta-business/marketing/audiences/instagram-operation.ts`
Expected: nenhum erro. Se aparecer erro, prove que é pré-existente rodando o mesmo comando sobre os arquivos da base (`git show origin/main:<arquivo> > <tmp>` não serve para eslint com caminho; use `git worktree add <tmp> origin/main` numa pasta temporária, rode lá e remova a worktree depois). Erro novo é defeito.

- [ ] **Step 6: Commit do código**

```bash
git add "app/(admin)/marketing/audiences/website-audience-editor.tsx" "app/(admin)/marketing/audiences/instagram-audience-editor.tsx" "app/api/meta-marketing/[accountId]/audiences/route.ts" tests/audience-period-copy.test.ts
git commit -m "fix(audiences): backoffice mostra o período com ajuda simples, sem jargão

Mesmos textos do frontend: período 30/365 com a faixa permitida, sem a
grade técnica de evidência, e orientação de fontes sem dizer que o
período está impedido.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Verificação no navegador com agent-browser (app rodando)**

Evidências no mesmo workspace do plano (`…/automatize-frontend-audience-period/docs/superpowers/plans/2026-09-30-audience-period-unblock/evidence/`), prefixo `backoffice-`. Receita conhecida (memória do projeto, 30/09):

1. `bun run dev:staging` na worktree do backoffice (porta 3006, banco staging `wsbsnzgzqiehqnklzchm`). NUNCA `bun dev` puro nem `APP_ENV=local` (aponta para produção).
2. Sessão sem Google: cookie `backoffice_magic_session` gerado por `createBackofficeMagicSessionToken(email)` (`lib/auth/magic-session.ts`), com um e-mail de `ADMIN_EMAILS` (`lib/config.ts`). Gere-o com um script temporário rodado por `APP_ENV=staging bun scripts/with-env.ts bun <script>`, grave o token em arquivo (nunca imprima), aplique só em localhost (`agent-browser cookies set … --url http://localhost:3006`) e apague o arquivo e o script no fim.
3. Simule com `agent-browser network route` (só HTTP 200) as rotas que dependem da Meta, lendo os tipos em `app/(admin)/marketing/audiences/page.tsx` e `audience-library-manager.tsx`: lista de usuários/contas que a página precisar, biblioteca vazia, `GET /api/meta-marketing/<conta>/audiences?userId=…&sources=website` com o mesmo corpo de fontes da Task 3 (SEM `periodEvidence`), `…&sources=instagram` com o mesmo corpo de perfis da Task 3 (SEM `periodEvidenceByProfile`) e o `POST /api/meta-marketing/<conta>/audiences?userId=…` de revisão com o mesmo corpo `Review` da Task 3.
4. Abra `http://localhost:3006/marketing/audiences`, abra **Criar público do site** e salve:
   - `backoffice-site-30-revisar.png` (período 30, ajuda visível, **Revisar** habilitado; confirme por `eval`);
   - `backoffice-site-181-erro.png` (181 → `O período deve ficar entre 1 e 180 dias para esta combinação.`, nenhum POST em `network requests`);
   - `backoffice-site-revisao.png` (30 → **Revisar** → painel de revisão; corpo do POST com `"retentionDays":30`; **não clique Confirmar**).
5. Abra **Criar público do Instagram** e salve `backoffice-instagram-365.png` (365, ajuda, **Revisar** habilitado).
6. `eval` de `document.body.innerText` sem `Unidade enviada`, `Limite local`, `fatos distintos`, `impedid`; salve em `evidence/backoffice-text-checks.txt`.
7. Pare o dev server, apague o cookie e os arquivos temporários.

Mesma regra de bloqueio/registro da Task 3.

---

## Finalização (orquestrador, depois das 5 tasks)

1. Suíte completa nos dois repositórios com os comandos de Global Constraints; compare `(fail)` com `baseline/frontend-fails.txt` e `baseline/backoffice-fails.txt`. Nenhuma falha nova; os testes novos aparecem como `(pass)`.
2. `bunx tsc --noEmit -p .` nos dois; nenhum erro novo em relação a `baseline/*-tsc.txt`.
3. Avaliação final (modelo do orquestrador) com spec, plano, diff das duas branches, `ledger.md` e `evidence/`.
4. Push das duas branches e PR contra `main` em cada repositório.

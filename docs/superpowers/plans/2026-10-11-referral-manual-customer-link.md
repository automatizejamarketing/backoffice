# Vínculo manual de indicado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um administrador do backoffice vincula manualmente um cliente existente como Indicado de um afiliado aprovado, pelo sheet de indicados, e o motor de comissão existente passa a comissionar as cobranças pagas desse cliente (passadas e futuras).

**Architecture:** O backoffice ganha um módulo puro de regras (`lib/referral/manual-link.ts`), um módulo de banco com a prévia somente-leitura e a transação de vínculo (`lib/referral/manual-link-queries.ts`), duas rotas (`POST /api/referrals/[affiliateId]/customers`, `GET .../customers/preview`) e um diálogo dentro do sheet existente. O motor de comissão do frontend NÃO muda: ele já comissiona todo pagamento elegível de qualquer `referral_customers`. A única mudança no frontend é espelhar o valor `customer_linked` na lista TypeScript de ações de auditoria.

**Tech Stack:** Next.js 16 (App Router, React 19), Drizzle ORM + postgres-js, bun (`node:test` + `node:assert/strict`), shadcn/ui (Radix Dialog/Sheet), agent-browser (Vercel Labs) para verificação de UI.

**Spec:** `docs/superpowers/specs/2026-10-11-referral-manual-customer-link-design.md` (nesta worktree do backoffice). Leia a spec inteira antes de qualquer tarefa — as mensagens e textos exatos estão lá (R3, R7, R9).

## Global Constraints

- Caminhos (use sempre absolutos):
  - **BO** = `D:/automatize-marketing/.worktrees/referral-manual-link/backoffice` (branch `feat/referral-manual-customer-link`)
  - **FE** = `D:/automatize-marketing/.worktrees/referral-manual-link/automatize-frontend` (branch `feat/referral-manual-link-action-type`)
  - **SP** = `C:/Users/rafae/AppData/Local/Temp/claude/D--automatize-marketing/90ab2ebb-825b-483f-a8dc-688cba3d8e63/scratchpad` (segredos e logs; NUNCA dentro de um repo)
  - **EV** = `BO/docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence` (evidências commitadas)
- **Nunca** trabalhe em `main`, no checkout principal (`D:/automatize-marketing/backoffice` ou `.../automatize-frontend`) nem em outra worktree. Nunca `git stash` puro.
- **bun only.** Nada de npm/yarn/pnpm.
- **Banco: só staging** (projeto Supabase `wsbsnzgzqiehqnklzchm`). Produção é `hosjqwtfjjtmphchsuqf` — nunca use `APP_ENV=local`/`prod`, nunca copie `.env.local`/`.env.prod` para as worktrees. Nenhum `SET` de sessão (o pooler 6543 vaza para as apps). Escritas na staging só as listadas nas Tasks 3, 5 e 6.
- **Sem migração**, sem `db:generate`, sem `db:push`. A coluna `referral_admin_actions.action` é `varchar` sem CHECK.
- **Não altere** o motor de comissão do frontend (`FE/lib/referral/commission*.ts`, `FE/lib/referral/queries.ts`) nem a atribuição.
- UI em pt-BR. Mensagens e textos **exatamente** como na spec (R3, R7, R9) — os testes comparam strings literais.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Suíte completa do backoffice, sempre deste jeito (Docker desligado — os testes com Postgres local falham igual na base):
  `cd BO && FRONTEND_ROOT=$FE POSTGRES_URL=postgres://postgres:referral@localhost:55452/referral_test POSTGRES_URL_NON_POOLING=postgres://postgres:referral@localhost:55452/referral_test bun test --timeout 30000`
- Suíte completa do frontend: `cd FE && POSTGRES_URL=postgres://postgres:referral@localhost:55452/referral_test POSTGRES_URL_NON_POOLING=postgres://postgres:referral@localhost:55452/referral_test bun test --timeout 30000 ./agent ./app ./apps ./components ./lib ./tests ./proxy-signed-out.test.ts ./proxy.test.ts`
- Base medida antes de qualquer mudança (mesmas worktrees): BO **1835 pass / 32 fail / 24 errors** (junit em `SP/bo-base.xml`); FE **3659 pass / 17 skip / 110 fail / 67 errors** (junit em `SP/fe-base.xml`).
- Lint por arquivo (`bunx eslint <arquivos>`); tipos: `bunx tsc --noEmit -p .` e filtrar pelos arquivos tocados (a base já tem ~40 erros alheios).

### Fixtures da staging (lidas em 2026-10-11, somente leitura)

| Papel | Valor |
|---|---|
| Afiliado (aprovado, 20% vitalícia, base líquido) | `26dcdc4f-4c07-4dd2-b8f9-4e255d52af1f` · código `VINDITESTE` · usuário `rafaeliffeng+u7@gmail.com` (`dd662c01-1a84-45d9-978c-2bef41a4032e`) · acordo `303350de-84bf-4d05-aa1c-ceb9c090701f` |
| **A** — vinculado por `curl` na Task 3 | `rafaeliffeng+r1u1@gmail.com` · `02b26403-9ce7-496d-b601-c7923ea88ea8` · pagamento `5420bd35-504e-44a6-8384-0eb0dbf31fce` (Stripe, líquido 47678) |
| **B** — vinculado pela UI na Task 5 | `educacaoleg+001@gmail.com` · `0f0f625d-0c02-488a-b75b-fa647eb00ec4` · pagamento `fd98259c-0671-44ec-ac09-dff993ace043` (Stripe, líquido 47678) |
| **C** — só prévia (líquido pendente) | `rafaeliffeng+r2ul4b@gmail.com` · `d734becf-70be-4969-818a-4a91e7058829` |
| **Z** — só prévia (zero cobranças) | `rafaeliffeng+r3k8@gmail.com` · `da78cd5c-c578-4267-af88-b04d884a9ddb` |
| **OWN** — conta do próprio afiliado | `dd662c01-1a84-45d9-978c-2bef41a4032e` |
| **EXISTING** — já indicado do VINDITESTE | `rafaeliffeng+u9@gmail.com` · `bc81c244-2199-4172-b5d7-f79b39f93ef2` · `signed_up_at` 2026-08-19 17:18 UTC → `19/08/2026` |

Comissão esperada para A e B: `Math.round(47678 * 2000 / 10000)` = **9536** centavos = `R$ 95,36` cada.

### Procedimentos comuns (referenciados pelas tarefas)

**P1 — sessão admin local (cookie mágico).** Gera o token num arquivo em SP (nunca imprima o token, nunca o coloque num commit):

```bash
mkdir -p "$BO/.scratch/rml"
cat > "$BO/.scratch/rml/make-session.ts" <<'EOF'
import { writeFileSync } from "node:fs";
import { createBackofficeMagicSessionToken } from "@/lib/auth/magic-session";
writeFileSync(process.argv[2], createBackofficeMagicSessionToken("educacaoleg@gmail.com"));
console.log("token written");
EOF
cd "$BO" && APP_ENV=staging bun scripts/with-env.ts bun .scratch/rml/make-session.ts "$SP/rml-session.token"
```
(`BO/.scratch/` é excluído do git via `.git/info/exclude`.) Reaproveite `SP/rml-session.token` se já existir.

**P2 — dev server do backoffice contra a staging.**
1. Porta livre: `netstat -ano | grep ":3006" | grep LISTENING` deve sair vazio. Se houver processo, pare-o só se for um `next dev` desta worktree.
2. Inicie com a ferramenta Bash em background (`run_in_background: true`): `cd "$BO" && bun run dev:staging > "$SP/rml-dev.log" 2>&1`
3. Espere: `curl --retry 40 --retry-delay 3 --retry-connrefused -s -o /dev/null -w "%{http_code}\n" http://localhost:3006/login` → `200`.
4. Ao terminar a tarefa, pare: `pid=$(netstat -ano | grep ":3006" | grep LISTENING | awk '{print $5}' | head -1); taskkill //PID $pid //T //F`.

**P3 — curl autenticado.** `C="backoffice_magic_session=$(cat "$SP/rml-session.token")"` e `curl -s -b "$C" ...`. Sem cookie, o `proxy.ts` responde 307 → `/login`.

**P4 — agent-browser autenticado** (headless; o Browser pane do app fica escondido e trava o Suspense — não use):
```bash
agent-browser open about:blank
agent-browser cookies set backoffice_magic_session "$(cat "$SP/rml-session.token")" --url http://localhost:3006 --httpOnly
agent-browser set viewport 1440 900
agent-browser open http://localhost:3006/referrals
agent-browser wait 'button[title="Ver indicados"]'
```
Use `agent-browser wait <ms>` ou seletor CSS (o `wait 'text=…'` não funciona na 0.38.1). Screenshots: `agent-browser screenshot "$EV/<nome>.png"`. Ao fim: `agent-browser cookies clear; agent-browser close`.

## Review Focus

1. **Busca fora de ordem** — o admin digita rápido; uma resposta antiga de `/api/users/search` chega depois da nova. Esperado: a lista mostra só o resultado da última busca. (Task 5, passo de verificação com `fetch` atrasado.)
2. **Seleção trocada em silêncio** — o admin escolhe um cliente e depois edita o texto da busca. Esperado: a seleção e a prévia somem; "Vincular" desabilita; nunca se vincula alguém diferente do que está na tela. (Task 5.)
3. **Clique duplo / reenvio** — "Vincular" clicado duas vezes ou o mesmo POST repetido. Esperado: um único Indicado; o segundo POST recebe 409 `Já é indicado deste afiliado desde …`. (Task 3, curl repetido; Task 5, botão desabilitado enquanto envia.)
4. **Corpo não-JSON ou campos de tipo errado** — `POST` com corpo inválido. Esperado: 400 `Usuário inválido`, nunca 500. (Task 3, curl.)
5. **Conta antiga sem `created_at` / afiliado sem nome** — Esperado: `signed_up_at` cai para o instante do vínculo; a mensagem de "já é indicado" usa o e-mail do outro afiliado. (Task 2, testes de unidade.)

---

### Task 1: Ação de auditoria `customer_linked` nos dois schemas + teste de paridade

**Files:**
- Create: `BO/tests/referral-admin-action-parity.test.ts`
- Modify: `BO/lib/db/schema.ts` (array `REFERRAL_ADMIN_ACTION_VALUES`, ~linha 4314)
- Modify: `FE/lib/db/schema.ts` (array `REFERRAL_ADMIN_ACTION_VALUES`, ~linha 4413)

**Interfaces:**
- Produces: `REFERRAL_ADMIN_ACTION_VALUES` inclui `"customer_linked"` (último item) nos dois repositórios; `ReferralAdminActionType` passa a aceitar `"customer_linked"` (usado na Task 3).

- [ ] **Step 1: Write the parity test**

`BO/tests/referral-admin-action-parity.test.ts`:
```ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { REFERRAL_ADMIN_ACTION_VALUES } from "../lib/db/schema";

// As ações de auditoria do programa de afiliados são uma lista só de
// TypeScript (a coluna é `varchar` sem CHECK). Os dois apps escrevem e leem a
// mesma tabela, então a lista tem de ser a mesma nos dois `schema.ts` — uma
// ação que só um lado conhece vira erro de tipo no outro.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function siblingFrontendSchema(backofficeRoot: string): string | null {
  const dirName = basename(backofficeRoot);
  const suffix = dirName.startsWith("backoffice")
    ? dirName.slice("backoffice".length)
    : "";
  const candidates = [
    ...(process.env.FRONTEND_ROOT
      ? [join(process.env.FRONTEND_ROOT, "lib", "db", "schema.ts")]
      : []),
    join(backofficeRoot, "..", `automatize-frontend${suffix}`, "lib", "db", "schema.ts"),
    join(backofficeRoot, "..", "automatize-frontend", "lib", "db", "schema.ts"),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function adminActionsDeclaredIn(source: string): string[] {
  const match = source.match(
    /export const REFERRAL_ADMIN_ACTION_VALUES = \[([\s\S]*?)\] as const;/,
  );
  if (!match) {
    throw new Error("REFERRAL_ADMIN_ACTION_VALUES não encontrado no schema do frontend");
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

const frontendSchema = siblingFrontendSchema(root);

test(
  "as ações de auditoria do programa de afiliados são as mesmas nos dois schemas",
  { skip: frontendSchema ? false : "schema do frontend não encontrado (defina FRONTEND_ROOT)" },
  () => {
    assert.deepEqual(
      [...REFERRAL_ADMIN_ACTION_VALUES],
      adminActionsDeclaredIn(readFileSync(frontendSchema as string, "utf8")),
    );
  },
);
```

- [ ] **Step 2: Run it — passes today (the lists are equal)**

Run: `cd "$BO" && FRONTEND_ROOT=$FE bun test tests/referral-admin-action-parity.test.ts`
Expected: `1 pass`. (Prova que o teste lê o arquivo certo.)

- [ ] **Step 3: Add `customer_linked` to the backoffice list only — watch the test fail**

Em `BO/lib/db/schema.ts`, no array `REFERRAL_ADMIN_ACTION_VALUES`, depois de `"tax_document_updated",` acrescente:
```ts
  // Vínculo manual de Indicado pelo backoffice (spec 2026-10-11).
  "customer_linked",
```
Run: `cd "$BO" && FRONTEND_ROOT=$FE bun test tests/referral-admin-action-parity.test.ts`
Expected: `1 fail` — `deepEqual` mostra `customer_linked` só no lado do backoffice.

- [ ] **Step 4: Mirror in the frontend — test passes**

Em `FE/lib/db/schema.ts`, no mesmo array, depois de `"tax_document_updated",` acrescente as mesmas duas linhas (comentário + `"customer_linked",`).
Run: `cd "$BO" && FRONTEND_ROOT=$FE bun test tests/referral-admin-action-parity.test.ts`
Expected: `1 pass`.

- [ ] **Step 5: Type-check both files**

Run: `cd "$BO" && bunx tsc --noEmit -p . 2>&1 | grep -E "lib/db/schema.ts|referral-admin-action-parity" ; echo "exit-grep $?"` → nenhuma linha (grep exit 1).
Run: `cd "$FE" && bunx tsc --noEmit -p . 2>&1 | grep -E "lib/db/schema.ts" ; echo "exit-grep $?"` → nenhuma linha. Se o `tsc` do FE regravar `tsconfig.tsbuildinfo`, desfaça: `git -C "$FE" checkout -- tsconfig.tsbuildinfo`.

- [ ] **Step 6: Commit (one commit per repo)**

```bash
git -C "$FE" add lib/db/schema.ts
git -C "$FE" commit -m "feat(afiliados): ação de auditoria customer_linked

Espelha o backoffice: vínculo manual de indicado (spec do backoffice
2026-10-11-referral-manual-customer-link). Lista só de TypeScript; a coluna
é varchar sem CHECK, então não há migração.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C "$BO" add lib/db/schema.ts tests/referral-admin-action-parity.test.ts
git -C "$BO" commit -m "feat(afiliados): ação customer_linked + paridade das ações com o frontend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regras puras do vínculo manual (`manual-link.ts`)

**Files:**
- Create: `BO/lib/referral/manual-link.ts`
- Test: `BO/lib/referral/manual-link.test.ts`

**Interfaces:**
- Consumes: `formatNumericDateInSaoPaulo(value, fallback?)` de `@/lib/backoffice/datetime-format`; `formatCentavos(centavos)` de `./write-off`; tipos `ReferralAgreementTerms` (`./agreement`), `ReferralAffiliateStatus` (`@/lib/db/schema`), `BackofficeActor` (`@/lib/auth/rbac-core`).
- Produces (usados nas Tasks 3–5):
  - constantes `MANUAL_LINK_REASON_MAX_LENGTH = 500`, `MANUAL_LINK_REASON_MESSAGE`, `MANUAL_LINK_ADMIN_ONLY_MESSAGE`, `MANUAL_LINK_INVALID_USER_MESSAGE`, `MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE`, `MANUAL_LINK_USER_NOT_FOUND_MESSAGE`, `REFERRAL_CUSTOMER_USER_UNIQUE_CONSTRAINT`
  - `manualLinkActorAllowed(actor: Pick<BackofficeActor, "role">): boolean`
  - `parseManualLinkReason(raw: unknown): { ok: true; reason: string } | { ok: false; message: string }`
  - `type ManualLinkState = { affiliate: { id: string; status: ReferralAffiliateStatus; userId: string }; agreement: { id: string } | null; user: { id: string; createdAt: Date | null } | null; existingCustomer: { affiliateId: string; affiliateLabel: string; signedUpAt: Date } | null }`
  - `type ManualLinkDecision = { ok: true; agreementId: string; signedUpAt: Date } | { ok: false; status: 404 | 409; message: string }`
  - `planManualReferralLink(state: ManualLinkState, now: Date): ManualLinkDecision`
  - `describeExistingCustomer(existing: NonNullable<ManualLinkState["existingCustomer"]>, affiliateId: string): string`
  - `type ManualLinkCharges = { eligibleCount: number; netCentavos: number; awaitingSettlementCount: number }`
  - `describeManualLinkCharges(charges: ManualLinkCharges): string`
  - `manualLinkCommissionQuota(agreement: Pick<ReferralAgreementTerms, "duration" | "durationCycles">): number | null`
  - `describeManualLinkQuota(agreement: Pick<ReferralAgreementTerms, "duration" | "durationCycles">, eligibleCount: number): string | null`
  - `isReferralCustomerUserUniqueViolation(error: unknown): boolean`
  - `type ReferralCustomerManualLink = { linkedAt: string; adminEmail: string }`
  - `indexManualLinks(actions: readonly { details: unknown; adminEmail: string; createdAt: Date }[]): Map<string, ReferralCustomerManualLink>`

- [ ] **Step 1: Write the failing tests**

`BO/lib/referral/manual-link.test.ts`:
```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  describeManualLinkCharges,
  describeManualLinkQuota,
  indexManualLinks,
  isReferralCustomerUserUniqueViolation,
  manualLinkActorAllowed,
  parseManualLinkReason,
  planManualReferralLink,
  type ManualLinkState,
} from "./manual-link";

// O que estes testes protegem: o vínculo manual move dinheiro — o motor de
// comissão passa a pagar as cobranças do cliente vinculado. Cada recusa abaixo
// é um caminho em que um `if` trocado de lugar pagaria o afiliado errado, ou
// pagaria por uma conta que é dele mesmo.

const NOW = new Date("2026-10-11T15:00:00.000Z");
const AFFILIATE_ID = "aff-1";

function state(overrides: Partial<ManualLinkState> = {}): ManualLinkState {
  return {
    affiliate: { id: AFFILIATE_ID, status: "approved", userId: "affiliate-user" },
    agreement: { id: "agreement-1" },
    user: { id: "user-1", createdAt: new Date("2026-09-05T12:00:00.000Z") },
    existingCustomer: null,
    ...overrides,
  };
}

describe("planManualReferralLink", () => {
  test("vincula ao acordo vigente, datado pelo cadastro da conta", () => {
    assert.deepEqual(planManualReferralLink(state(), NOW), {
      ok: true,
      agreementId: "agreement-1",
      signedUpAt: new Date("2026-09-05T12:00:00.000Z"),
    });
  });

  test("conta antiga sem created_at fica datada pelo instante do vínculo", () => {
    assert.deepEqual(
      planManualReferralLink(state({ user: { id: "user-1", createdAt: null } }), NOW),
      { ok: true, agreementId: "agreement-1", signedUpAt: NOW },
    );
  });

  const refusals: Array<{ name: string; input: ManualLinkState; status: 404 | 409; message: string }> = [
    {
      name: "usuário inexistente",
      input: state({ user: null }),
      status: 404,
      message: "Usuário não encontrado",
    },
    {
      name: "afiliado pendente",
      input: state({ affiliate: { id: AFFILIATE_ID, status: "pending", userId: "affiliate-user" } }),
      status: 409,
      message: "Só afiliado aprovado pode receber indicado",
    },
    {
      name: "afiliado bloqueado",
      input: state({ affiliate: { id: AFFILIATE_ID, status: "blocked", userId: "affiliate-user" } }),
      status: 409,
      message: "Só afiliado aprovado pode receber indicado",
    },
    {
      name: "afiliado sem acordo vigente",
      input: state({ agreement: null }),
      status: 409,
      message: "Afiliado sem acordo vigente",
    },
    {
      name: "a conta do próprio afiliado",
      input: state({ user: { id: "affiliate-user", createdAt: NOW } }),
      status: 409,
      message: "Esta é a conta do próprio afiliado",
    },
    {
      name: "já indicado deste afiliado",
      input: state({
        existingCustomer: {
          affiliateId: AFFILIATE_ID,
          affiliateLabel: "U7 Expert",
          signedUpAt: new Date("2026-08-19T17:18:11.234Z"),
        },
      }),
      status: 409,
      message: "Já é indicado deste afiliado desde 19/08/2026",
    },
    {
      name: "já indicado de outro afiliado",
      input: state({
        existingCustomer: {
          affiliateId: "aff-2",
          affiliateLabel: "Queens Burgers",
          signedUpAt: new Date("2026-09-30T13:00:00.000Z"),
        },
      }),
      status: 409,
      message: "Já é indicado de Queens Burgers desde 30/09/2026",
    },
  ];

  for (const { name, input, status, message } of refusals) {
    test(`recusa: ${name}`, () => {
      assert.deepEqual(planManualReferralLink(input, NOW), { ok: false, status, message });
    });
  }

  test("usuário inexistente vence o status do afiliado (ordem da tabela R7)", () => {
    const decision = planManualReferralLink(
      state({ user: null, affiliate: { id: AFFILIATE_ID, status: "blocked", userId: "x" } }),
      NOW,
    );
    assert.deepEqual(decision, { ok: false, status: 404, message: "Usuário não encontrado" });
  });
});

describe("parseManualLinkReason", () => {
  test("aceita e apara o motivo", () => {
    assert.deepEqual(parseManualLinkReason("  veio por WhatsApp  "), { ok: true, reason: "veio por WhatsApp" });
  });

  const invalid: Array<[string, unknown]> = [
    ["vazio", ""],
    ["só espaços", "    "],
    ["não é texto", 42],
    ["ausente", undefined],
    ["acima de 500 caracteres", "x".repeat(501)],
  ];
  for (const [name, raw] of invalid) {
    test(`recusa motivo ${name}`, () => {
      assert.deepEqual(parseManualLinkReason(raw), {
        ok: false,
        message: "Informe o motivo do vínculo (até 500 caracteres)",
      });
    });
  }

  test("500 caracteres é o limite aceito", () => {
    assert.equal(parseManualLinkReason("x".repeat(500)).ok, true);
  });
});

describe("manualLinkActorAllowed", () => {
  test("só o cargo admin vincula", () => {
    assert.equal(manualLinkActorAllowed({ role: "admin" }), true);
    assert.equal(manualLinkActorAllowed({ role: "dev" }), false);
    assert.equal(manualLinkActorAllowed({ role: "marketing_consultant_premium" }), false);
    assert.equal(manualLinkActorAllowed({ role: "comercial" }), false);
  });
});

describe("describeManualLinkCharges", () => {
  test("nenhuma cobrança", () => {
    assert.equal(
      describeManualLinkCharges({ eligibleCount: 0, netCentavos: 0, awaitingSettlementCount: 0 }),
      "Nenhuma cobrança paga até agora — só as próximas vão comissionar",
    );
  });
  test("uma cobrança, sem pendência de liquidação", () => {
    assert.equal(
      describeManualLinkCharges({ eligibleCount: 1, netCentavos: 9700, awaitingSettlementCount: 0 }),
      "1 cobrança de assinatura paga · R$ 97,00 de líquido",
    );
  });
  test("várias cobranças, uma aguardando liquidação", () => {
    assert.equal(
      describeManualLinkCharges({ eligibleCount: 6, netCentavos: 116400, awaitingSettlementCount: 1 }),
      "6 cobranças de assinatura pagas · R$ 1.164,00 de líquido · 1 aguardando liquidação",
    );
  });
  test("duas aguardando liquidação", () => {
    assert.equal(
      describeManualLinkCharges({ eligibleCount: 2, netCentavos: 0, awaitingSettlementCount: 2 }),
      "2 cobranças de assinatura pagas · R$ 0,00 de líquido · 2 aguardando liquidação",
    );
  });
});

describe("describeManualLinkQuota", () => {
  test("vitalícia não tem aviso", () => {
    assert.equal(describeManualLinkQuota({ duration: "lifetime", durationCycles: null }, 6), null);
  });
  test("sem cobranças não tem aviso", () => {
    assert.equal(describeManualLinkQuota({ duration: "n_cycles", durationCycles: 3 }, 0), null);
  });
  test("primeira venda: a mais antiga leva a única comissão", () => {
    assert.equal(
      describeManualLinkQuota({ duration: "first_sale", durationCycles: null }, 4),
      "A cobrança mais antiga consome 1 de 1 comissão do acordo. As próximas cobranças não vão comissionar.",
    );
  });
  test("3 ciclos com 1 cobrança", () => {
    assert.equal(
      describeManualLinkQuota({ duration: "n_cycles", durationCycles: 3 }, 1),
      "A cobrança mais antiga consome 1 de 3 comissões do acordo.",
    );
  });
  test("3 ciclos com 2 cobranças", () => {
    assert.equal(
      describeManualLinkQuota({ duration: "n_cycles", durationCycles: 3 }, 2),
      "As 2 cobranças mais antigas consomem 2 de 3 comissões do acordo.",
    );
  });
  test("3 ciclos com 6 cobranças esgota a cota", () => {
    assert.equal(
      describeManualLinkQuota({ duration: "n_cycles", durationCycles: 3 }, 6),
      "As 3 cobranças mais antigas consomem 3 de 3 comissões do acordo. As próximas cobranças não vão comissionar.",
    );
  });
});

describe("isReferralCustomerUserUniqueViolation", () => {
  const violation = { code: "23505", constraint_name: "referral_customers_user_id_unique" };
  test("o erro do postgres-js direto", () => {
    assert.equal(isReferralCustomerUserUniqueViolation(violation), true);
  });
  test("embrulhado pelo Drizzle em cause", () => {
    assert.equal(
      isReferralCustomerUserUniqueViolation(new Error("Failed query", { cause: violation })),
      true,
    );
  });
  test("outra trava única não conta", () => {
    assert.equal(
      isReferralCustomerUserUniqueViolation({ code: "23505", constraint_name: "users_email_unique" }),
      false,
    );
  });
  test("outro erro não conta", () => {
    assert.equal(isReferralCustomerUserUniqueViolation(new Error("boom")), false);
    assert.equal(isReferralCustomerUserUniqueViolation(null), false);
  });
  test("cause circular não trava", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    assert.equal(isReferralCustomerUserUniqueViolation(loop), false);
  });
});

describe("indexManualLinks", () => {
  test("indexa pelo customerId gravado em details e ignora linhas sem ele", () => {
    const links = indexManualLinks([
      { details: { customerId: "c1", userId: "u1" }, adminEmail: "a@x.com", createdAt: new Date("2026-10-11T12:00:00.000Z") },
      { details: null, adminEmail: "b@x.com", createdAt: new Date("2026-10-11T13:00:00.000Z") },
      { details: { customerId: 7 }, adminEmail: "c@x.com", createdAt: new Date("2026-10-11T14:00:00.000Z") },
    ]);
    assert.deepEqual([...links.entries()], [
      ["c1", { linkedAt: "2026-10-11T12:00:00.000Z", adminEmail: "a@x.com" }],
    ]);
  });
  test("se houver duas linhas para o mesmo indicado, vale a mais antiga", () => {
    const links = indexManualLinks([
      { details: { customerId: "c1" }, adminEmail: "late@x.com", createdAt: new Date("2026-10-12T12:00:00.000Z") },
      { details: { customerId: "c1" }, adminEmail: "first@x.com", createdAt: new Date("2026-10-11T12:00:00.000Z") },
    ]);
    assert.equal(links.get("c1")?.adminEmail, "first@x.com");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "$BO" && bun test lib/referral/manual-link.test.ts`
Expected: erro `Cannot find module './manual-link'`. Crie então um esqueleto com as mesmas exportações devolvendo valores errados (ex.: `planManualReferralLink` → `{ ok: false, status: 404, message: "" }`, textos `""`, booleanos `false`, `new Map()`), rode de novo e confirme que **as asserções** falham (não erro de módulo).

- [ ] **Step 3: Write the implementation**

`BO/lib/referral/manual-link.ts`:
```ts
// Vínculo manual de Indicado — as regras, sem banco.
//
// Um administrador liga uma conta que já existe a um afiliado aprovado. Tudo o
// que decide se o vínculo pode acontecer mora aqui, com teste; a rota e a
// transação (`manual-link-queries.ts`) só buscam o estado e aplicam a decisão.
//
// O motor de comissão do frontend não muda (spec 2026-10-11, D2): ele passa a
// enxergar o Indicado novo e comissiona as cobranças pagas dele — inclusive as
// passadas — pela regra de sempre. Por isso a prévia mostra a BASE (cobranças e
// líquido) e nunca uma estimativa: estimar seria uma segunda cópia da regra de
// dinheiro (D7).

import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { formatNumericDateInSaoPaulo } from "@/lib/backoffice/datetime-format";
import type { ReferralAffiliateStatus } from "@/lib/db/schema";
import type { ReferralAgreementTerms } from "./agreement";
import { formatCentavos } from "./write-off";

export const MANUAL_LINK_REASON_MAX_LENGTH = 500;
export const MANUAL_LINK_REASON_MESSAGE =
  "Informe o motivo do vínculo (até 500 caracteres)";
export const MANUAL_LINK_ADMIN_ONLY_MESSAGE =
  "Apenas administradores podem vincular indicados";
export const MANUAL_LINK_INVALID_USER_MESSAGE = "Usuário inválido";
export const MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE = "Afiliado não encontrado";
export const MANUAL_LINK_USER_NOT_FOUND_MESSAGE = "Usuário não encontrado";
/** A trava única de `referral_customers.user_id` (migration 0041). */
export const REFERRAL_CUSTOMER_USER_UNIQUE_CONSTRAINT =
  "referral_customers_user_id_unique";

/**
 * Só o cargo `admin`. Hoje `affiliates:manage` já é exclusivo dele, mas o
 * pedido é explícito sobre o CARGO: se a permissão um dia for concedida a
 * outro papel, vincular continua sendo de administrador.
 */
export function manualLinkActorAllowed(
  actor: Pick<BackofficeActor, "role">,
): boolean {
  return actor.role === "admin";
}

export type ManualLinkReasonResult =
  | { ok: true; reason: string }
  | { ok: false; message: string };

export function parseManualLinkReason(raw: unknown): ManualLinkReasonResult {
  if (typeof raw !== "string") {
    return { ok: false, message: MANUAL_LINK_REASON_MESSAGE };
  }
  const reason = raw.trim();
  if (reason.length === 0 || reason.length > MANUAL_LINK_REASON_MAX_LENGTH) {
    return { ok: false, message: MANUAL_LINK_REASON_MESSAGE };
  }
  return { ok: true, reason };
}

export type ManualLinkState = {
  affiliate: { id: string; status: ReferralAffiliateStatus; userId: string };
  agreement: { id: string } | null;
  user: { id: string; createdAt: Date | null } | null;
  /** O Indicado que este usuário já é, de qualquer afiliado. */
  existingCustomer: {
    affiliateId: string;
    /** Nome do afiliado dono, ou o e-mail quando não há nome. */
    affiliateLabel: string;
    signedUpAt: Date;
  } | null;
};

export type ManualLinkDecision =
  | { ok: true; agreementId: string; signedUpAt: Date }
  | { ok: false; status: 404 | 409; message: string };

function refuse(status: 404 | 409, message: string): ManualLinkDecision {
  return { ok: false, status, message };
}

export function describeExistingCustomer(
  existing: NonNullable<ManualLinkState["existingCustomer"]>,
  affiliateId: string,
): string {
  const since = formatNumericDateInSaoPaulo(existing.signedUpAt);
  return existing.affiliateId === affiliateId
    ? `Já é indicado deste afiliado desde ${since}`
    : `Já é indicado de ${existing.affiliateLabel} desde ${since}`;
}

/**
 * A decisão, na ordem da tabela R7 da spec. O Indicado nasce no acordo
 * VIGENTE do afiliado e datado pelo cadastro da conta — como na atribuição
 * por clique (`attribution-service.ts`: `accountCreatedAt ?? new Date()`).
 */
export function planManualReferralLink(
  state: ManualLinkState,
  now: Date,
): ManualLinkDecision {
  const { affiliate, agreement, user, existingCustomer } = state;
  if (!user) return refuse(404, MANUAL_LINK_USER_NOT_FOUND_MESSAGE);
  if (affiliate.status !== "approved") {
    return refuse(409, "Só afiliado aprovado pode receber indicado");
  }
  if (!agreement) return refuse(409, "Afiliado sem acordo vigente");
  // A mesma regra da atribuição: indicar a si mesmo não gera comissão (ADR 0024).
  if (user.id === affiliate.userId) {
    return refuse(409, "Esta é a conta do próprio afiliado");
  }
  // O primeiro afiliado é dono para sempre (D3): nunca transferir.
  if (existingCustomer) {
    return refuse(409, describeExistingCustomer(existingCustomer, affiliate.id));
  }
  return {
    ok: true,
    agreementId: agreement.id,
    signedUpAt: user.createdAt ?? now,
  };
}

export type ManualLinkCharges = {
  /** Cobranças que a varredura do motor vai processar (cortes de R9). */
  eligibleCount: number;
  /** Soma do líquido das elegíveis que já o têm. */
  netCentavos: number;
  /** Elegíveis ainda sem líquido — esperam o reconciliador. */
  awaitingSettlementCount: number;
};

export function describeManualLinkCharges(charges: ManualLinkCharges): string {
  if (charges.eligibleCount === 0) {
    return "Nenhuma cobrança paga até agora — só as próximas vão comissionar";
  }
  const count =
    charges.eligibleCount === 1
      ? "1 cobrança de assinatura paga"
      : `${charges.eligibleCount} cobranças de assinatura pagas`;
  const parts = [count, `${formatCentavos(charges.netCentavos)} de líquido`];
  if (charges.awaitingSettlementCount > 0) {
    parts.push(`${charges.awaitingSettlementCount} aguardando liquidação`);
  }
  return parts.join(" · ");
}

/**
 * Quantas comissões o acordo concede a um Indicado. Espelha
 * `agreementCommissionQuota` do motor (automatize-frontend
 * `lib/referral/commission.ts`): só informa a prévia, nunca decide dinheiro.
 */
export function manualLinkCommissionQuota(
  agreement: Pick<ReferralAgreementTerms, "duration" | "durationCycles">,
): number | null {
  switch (agreement.duration) {
    case "first_sale":
      return 1;
    case "n_cycles":
      return agreement.durationCycles ?? 0;
    default:
      return null;
  }
}

/**
 * O aviso de cota: a varredura do motor processa da cobrança mais antiga para
 * a mais nova, então o histórico consome a cota antes das cobranças futuras.
 */
export function describeManualLinkQuota(
  agreement: Pick<ReferralAgreementTerms, "duration" | "durationCycles">,
  eligibleCount: number,
): string | null {
  const quota = manualLinkCommissionQuota(agreement);
  if (quota === null) return null;
  const consumed = Math.min(eligibleCount, quota);
  if (consumed < 1) return null;
  const unit = quota === 1 ? "comissão" : "comissões";
  const head =
    consumed === 1
      ? `A cobrança mais antiga consome 1 de ${quota} ${unit} do acordo.`
      : `As ${consumed} cobranças mais antigas consomem ${consumed} de ${quota} ${unit} do acordo.`;
  return consumed === quota
    ? `${head} As próximas cobranças não vão comissionar.`
    : head;
}

/**
 * A corrida perdida para a trava única de `referral_customers.user_id`. O
 * Drizzle embrulha o erro do postgres-js em `cause`, então a busca desce pela
 * cadeia (com teto e sem seguir ciclo).
 */
export function isReferralCustomerUserUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object" || seen.has(current)) return false;
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === "23505" &&
      candidate.constraint_name === REFERRAL_CUSTOMER_USER_UNIQUE_CONSTRAINT
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export type ReferralCustomerManualLink = { linkedAt: string; adminEmail: string };

/** As linhas `customer_linked` da auditoria, indexadas pelo Indicado. */
export function indexManualLinks(
  actions: readonly { details: unknown; adminEmail: string; createdAt: Date }[],
): Map<string, ReferralCustomerManualLink> {
  const ordered = [...actions].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  const links = new Map<string, ReferralCustomerManualLink>();
  for (const action of ordered) {
    const customerId =
      action.details && typeof action.details === "object"
        ? (action.details as { customerId?: unknown }).customerId
        : undefined;
    if (typeof customerId !== "string" || links.has(customerId)) continue;
    links.set(customerId, {
      linkedAt: action.createdAt.toISOString(),
      adminEmail: action.adminEmail,
    });
  }
  return links;
}
```

- [ ] **Step 4: Run the tests — all pass**

Run: `cd "$BO" && bun test lib/referral/manual-link.test.ts`
Expected: todos `pass`, `0 fail`.

- [ ] **Step 5: Lint + types**

Run: `cd "$BO" && bunx eslint lib/referral/manual-link.ts lib/referral/manual-link.test.ts` → exit 0.
Run: `cd "$BO" && bunx tsc --noEmit -p . 2>&1 | grep "lib/referral/manual-link" ; echo "exit-grep $?"` → nenhuma linha.

- [ ] **Step 6: Commit**

```bash
git -C "$BO" add lib/referral/manual-link.ts lib/referral/manual-link.test.ts
git -C "$BO" commit -m "feat(afiliados): regras puras do vínculo manual de indicado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Prévia e transação do vínculo + rotas `POST` e `GET preview`

**Files:**
- Create: `BO/lib/referral/manual-link-queries.ts`
- Create: `BO/app/api/referrals/[affiliateId]/customers/preview/route.ts`
- Modify: `BO/app/api/referrals/[affiliateId]/customers/route.ts` (acrescentar `POST`; o `GET` existente fica como está)
- Evidence: `EV/task3-api.txt`

**Interfaces:**
- Consumes (Task 2): `planManualReferralLink`, `describeExistingCustomer`, `isReferralCustomerUserUniqueViolation`, `manualLinkActorAllowed`, `parseManualLinkReason`, as constantes de mensagem, `type ManualLinkCharges`, `type ManualLinkState`. De `./queries`: `ReferralOperationError` (`constructor(status: 400 | 404 | 409, message)`). De `./agreement`: `type ReferralAgreementTerms`. Task 1: `"customer_linked"` válido em `referralAdminAction.action`.
- Produces:
  - `type ManualLinkPreview = { user: { id: string; email: string; name: string | null }; blocked: { message: string } | null; agreement: ReferralAgreementTerms | null; charges: ManualLinkCharges }`
  - `previewManualReferralLink(affiliateId: string, userId: string, now?: Date): Promise<ManualLinkPreview>` — lança `ReferralOperationError(404, …)` para afiliado/usuário inexistente.
  - `type ManualLinkResult = { customerId: string; agreementId: string; signedUpAt: string }`
  - `linkReferralCustomerManually(args: { affiliateId: string; userId: string; reason: string; adminEmail: string; now?: Date }): Promise<ManualLinkResult>` — lança `ReferralOperationError` 404/409.
  - Rotas: `POST /api/referrals/[affiliateId]/customers` (201 `ManualLinkResult`) e `GET /api/referrals/[affiliateId]/customers/preview?userId=` (200 `ManualLinkPreview`), com os status/mensagens de R7/R9.

- [ ] **Step 1: Write `manual-link-queries.ts`**

```ts
// O vínculo manual de Indicado ligado ao banco. As regras moram em
// `manual-link.ts`, com teste; aqui só se busca estado e se grava a decisão.
//
// A prévia é somente leitura. O vínculo é UMA transação que trava a linha do
// afiliado (o idioma de aprovar/renegociar/bloquear), relê tudo e grava o
// Indicado e a auditoria juntos. A trava única de `referral_customers.user_id`
// é a última palavra contra a corrida — inclusive contra uma atribuição por
// clique gravada pelo frontend no mesmo instante.

import { and, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payment,
  referralAdminAction,
  referralAffiliate,
  referralAgreement,
  referralCustomer,
  user,
} from "@/lib/db/schema";
import type { ReferralAgreementTerms } from "./agreement";
import {
  isReferralCustomerUserUniqueViolation,
  MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE,
  MANUAL_LINK_USER_NOT_FOUND_MESSAGE,
  planManualReferralLink,
  type ManualLinkCharges,
  type ManualLinkState,
} from "./manual-link";
import { ReferralOperationError } from "./queries";

type Executor =
  | typeof db
  | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

export type ManualLinkPreview = {
  user: { id: string; email: string; name: string | null };
  /** Por que o vínculo seria recusado agora — as recusas 409 de R7. */
  blocked: { message: string } | null;
  agreement: ReferralAgreementTerms | null;
  charges: ManualLinkCharges;
};

export type ManualLinkResult = {
  customerId: string;
  agreementId: string;
  signedUpAt: string;
};

type LoadedManualLink = {
  state: ManualLinkState;
  agreement: (ReferralAgreementTerms & { id: string }) | null;
  user: { id: string; email: string; name: string | null } | null;
};

async function loadManualLinkState(
  executor: Executor,
  affiliateId: string,
  userId: string,
  lockAffiliate: boolean,
): Promise<LoadedManualLink> {
  const affiliateQuery = executor
    .select({
      id: referralAffiliate.id,
      status: referralAffiliate.status,
      userId: referralAffiliate.userId,
    })
    .from(referralAffiliate)
    .where(eq(referralAffiliate.id, affiliateId))
    .limit(1);
  const [affiliateRow] = lockAffiliate
    ? await affiliateQuery.for("update")
    : await affiliateQuery;
  if (!affiliateRow) {
    throw new ReferralOperationError(404, MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE);
  }

  const [agreementRow] = await executor
    .select({
      id: referralAgreement.id,
      format: referralAgreement.format,
      percentageBps: referralAgreement.percentageBps,
      fixedAmountCentavos: referralAgreement.fixedAmountCentavos,
      duration: referralAgreement.duration,
      durationCycles: referralAgreement.durationCycles,
    })
    .from(referralAgreement)
    .where(
      and(
        eq(referralAgreement.affiliateId, affiliateId),
        isNull(referralAgreement.supersededAt),
      ),
    )
    .limit(1);

  const [userRow] = await executor
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  // O dono atual deste usuário, de qualquer afiliado — com o nome (ou e-mail)
  // do afiliado dono para a mensagem de recusa.
  const [existingRow] = await executor
    .select({
      affiliateId: referralCustomer.affiliateId,
      signedUpAt: referralCustomer.signedUpAt,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(referralCustomer)
    .innerJoin(referralAffiliate, eq(referralAffiliate.id, referralCustomer.affiliateId))
    .innerJoin(user, eq(user.id, referralAffiliate.userId))
    .where(eq(referralCustomer.userId, userId))
    .limit(1);

  return {
    state: {
      affiliate: affiliateRow,
      agreement: agreementRow ? { id: agreementRow.id } : null,
      user: userRow ? { id: userRow.id, createdAt: userRow.createdAt } : null,
      existingCustomer: existingRow
        ? {
            affiliateId: existingRow.affiliateId,
            affiliateLabel: existingRow.ownerName?.trim() || existingRow.ownerEmail,
            signedUpAt: existingRow.signedUpAt,
          }
        : null,
    },
    agreement: agreementRow ?? null,
    user: userRow ? { id: userRow.id, email: userRow.email, name: userRow.name } : null,
  };
}

/**
 * As cobranças que a varredura do motor vai processar para este usuário. Os
 * cortes copiam `findPaymentsPendingCommission` (automatize-frontend
 * `lib/referral/queries.ts`): se a varredura mudar, esta prévia muda junto.
 */
async function countManualLinkCharges(
  executor: Executor,
  userId: string,
): Promise<ManualLinkCharges> {
  const [row] = await executor
    .select({
      eligibleCount: sql<number>`count(*)::int`,
      netCentavos: sql<number>`coalesce(sum(${payment.netAmount}), 0)::int`,
      awaitingSettlementCount: sql<number>`(count(*) filter (where ${payment.netAmount} is null))::int`,
    })
    .from(payment)
    .where(
      and(
        eq(payment.userId, userId),
        eq(payment.status, "succeeded"),
        or(isNull(payment.purpose), eq(payment.purpose, "subscription")),
        isNotNull(payment.externalId),
        gt(sql`coalesce(${payment.grossAmount}, ${payment.amount})`, 0),
      ),
    );
  return {
    eligibleCount: Number(row?.eligibleCount ?? 0),
    netCentavos: Number(row?.netCentavos ?? 0),
    awaitingSettlementCount: Number(row?.awaitingSettlementCount ?? 0),
  };
}

export async function previewManualReferralLink(
  affiliateId: string,
  userId: string,
  now: Date = new Date(),
): Promise<ManualLinkPreview> {
  const loaded = await loadManualLinkState(db, affiliateId, userId, false);
  if (!loaded.user) {
    throw new ReferralOperationError(404, MANUAL_LINK_USER_NOT_FOUND_MESSAGE);
  }
  const decision = planManualReferralLink(loaded.state, now);
  const charges = await countManualLinkCharges(db, userId);
  return {
    user: loaded.user,
    blocked: decision.ok ? null : { message: decision.message },
    agreement: loaded.agreement
      ? {
          format: loaded.agreement.format,
          percentageBps: loaded.agreement.percentageBps,
          fixedAmountCentavos: loaded.agreement.fixedAmountCentavos,
          duration: loaded.agreement.duration,
          durationCycles: loaded.agreement.durationCycles,
        }
      : null,
    charges,
  };
}

export async function linkReferralCustomerManually(args: {
  affiliateId: string;
  userId: string;
  reason: string;
  adminEmail: string;
  now?: Date;
}): Promise<ManualLinkResult> {
  const now = args.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const loaded = await loadManualLinkState(tx, args.affiliateId, args.userId, true);
      const decision = planManualReferralLink(loaded.state, now);
      if (!decision.ok) {
        throw new ReferralOperationError(decision.status, decision.message);
      }

      const [customer] = await tx
        .insert(referralCustomer)
        .values({
          userId: args.userId,
          affiliateId: args.affiliateId,
          agreementId: decision.agreementId,
          signedUpAt: decision.signedUpAt,
          createdAt: now,
        })
        .returning({ id: referralCustomer.id });

      await tx.insert(referralAdminAction).values({
        affiliateId: args.affiliateId,
        adminEmail: args.adminEmail,
        action: "customer_linked",
        reason: args.reason,
        details: {
          customerId: customer.id,
          userId: args.userId,
          userEmail: loaded.user?.email ?? null,
          agreementId: decision.agreementId,
        },
        createdAt: now,
      });

      return {
        customerId: customer.id,
        agreementId: decision.agreementId,
        signedUpAt: decision.signedUpAt.toISOString(),
      };
    });
  } catch (error) {
    if (!isReferralCustomerUserUniqueViolation(error)) throw error;
    // Corrida perdida: outro vínculo (manual ou por clique) gravou este usuário
    // entre a leitura e a escrita. Relê para dizer de quem ele é agora.
    const loaded = await loadManualLinkState(db, args.affiliateId, args.userId, false);
    const decision = planManualReferralLink(loaded.state, now);
    throw new ReferralOperationError(
      409,
      decision.ok ? "Este usuário acabou de ser vinculado a um afiliado" : decision.message,
    );
  }
}
```

- [ ] **Step 2: Add `POST` to the customers route**

Em `BO/app/api/referrals/[affiliateId]/customers/route.ts`, troque os imports do topo por:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getReferralAffiliateCustomers } from "@/lib/referral/customer-queries";
import {
  MANUAL_LINK_ADMIN_ONLY_MESSAGE,
  MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE,
  MANUAL_LINK_INVALID_USER_MESSAGE,
  manualLinkActorAllowed,
  parseManualLinkReason,
} from "@/lib/referral/manual-link";
import { linkReferralCustomerManually } from "@/lib/referral/manual-link-queries";
import { ReferralOperationError } from "@/lib/referral/queries";
```
Mantenha o `type Context` e o `GET` como estão e acrescente no fim do arquivo:
```ts
/**
 * Vínculo manual de Indicado (spec 2026-10-11, R7/R8). Só o cargo admin; a
 * ordem das recusas é a da tabela R7.
 */
export async function POST(request: Request, context: Context) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;
  if (!manualLinkActorAllowed(authz.actor)) {
    return NextResponse.json({ error: MANUAL_LINK_ADMIN_ONLY_MESSAGE }, { status: 403 });
  }

  const affiliateId = z.string().uuid().safeParse((await context.params).affiliateId);
  if (!affiliateId.success) {
    return NextResponse.json({ error: MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE }, { status: 404 });
  }

  // Corpo que não é JSON é um pedido inválido, não um erro do servidor.
  const body = (await request.json().catch(() => null)) as
    | { userId?: unknown; reason?: unknown }
    | null;
  const userId = z.string().uuid().safeParse(body?.userId);
  if (!userId.success) {
    return NextResponse.json({ error: MANUAL_LINK_INVALID_USER_MESSAGE }, { status: 400 });
  }
  const reason = parseManualLinkReason(body?.reason);
  if (!reason.ok) {
    return NextResponse.json({ error: reason.message }, { status: 400 });
  }

  try {
    const result = await linkReferralCustomerManually({
      affiliateId: affiliateId.data,
      userId: userId.data,
      reason: reason.reason,
      adminEmail: authz.actor.email,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[referral] failed to link customer manually", error);
    return NextResponse.json({ error: "Erro ao vincular o indicado" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create the preview route**

`BO/app/api/referrals/[affiliateId]/customers/preview/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  MANUAL_LINK_ADMIN_ONLY_MESSAGE,
  MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE,
  MANUAL_LINK_INVALID_USER_MESSAGE,
  manualLinkActorAllowed,
} from "@/lib/referral/manual-link";
import { previewManualReferralLink } from "@/lib/referral/manual-link-queries";
import { ReferralOperationError } from "@/lib/referral/queries";

type Context = { params: Promise<{ affiliateId: string }> };

/**
 * A prévia do vínculo manual (spec 2026-10-11, R9): só leitura. As recusas
 * 409 do vínculo voltam como `blocked.message`, com 200 — a prévia informa, o
 * POST decide.
 */
export async function GET(request: Request, context: Context) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;
  if (!manualLinkActorAllowed(authz.actor)) {
    return NextResponse.json({ error: MANUAL_LINK_ADMIN_ONLY_MESSAGE }, { status: 403 });
  }

  const affiliateId = z.string().uuid().safeParse((await context.params).affiliateId);
  if (!affiliateId.success) {
    return NextResponse.json({ error: MANUAL_LINK_AFFILIATE_NOT_FOUND_MESSAGE }, { status: 404 });
  }
  const userId = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("userId"));
  if (!userId.success) {
    return NextResponse.json({ error: MANUAL_LINK_INVALID_USER_MESSAGE }, { status: 400 });
  }

  try {
    return NextResponse.json(await previewManualReferralLink(affiliateId.data, userId.data));
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[referral] failed to preview manual link", error);
    return NextResponse.json({ error: "Erro ao carregar a prévia" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Lint + types**

Run: `cd "$BO" && bunx eslint lib/referral/manual-link-queries.ts "app/api/referrals/[affiliateId]/customers/route.ts" "app/api/referrals/[affiliateId]/customers/preview/route.ts"` → exit 0.
Run: `cd "$BO" && bunx tsc --noEmit -p . 2>&1 | grep -E "manual-link|referrals/\[affiliateId\]" ; echo "exit-grep $?"` → nenhuma linha.

- [ ] **Step 5: Verify the API against staging (P1, P2, P3)**

Com o dev server no ar (P2) e o cookie (P3). Defina `AFF=26dcdc4f-4c07-4dd2-b8f9-4e255d52af1f` e `B="http://localhost:3006/api/referrals"`. Rode cada linha e grave o comando + status + corpo em `EV/task3-api.txt` (use `curl -s -w "\nHTTP %{http_code}\n"`; nada de cookie no arquivo):

| # | Pedido | Esperado |
|---|---|---|
| 1 | `GET $B/$AFF/customers/preview?userId=da78cd5c-c578-4267-af88-b04d884a9ddb` (Z) | 200, `blocked:null`, `charges` `{eligibleCount:0,netCentavos:0,awaitingSettlementCount:0}`, `agreement.percentageBps:2000`, `duration:"lifetime"` |
| 2 | preview `userId=d734becf-70be-4969-818a-4a91e7058829` (C) | 200, `blocked:null`, `eligibleCount:1`, `awaitingSettlementCount:1`, `netCentavos:0` |
| 3 | preview `userId=02b26403-9ce7-496d-b601-c7923ea88ea8` (A) | 200, `blocked:null`, `eligibleCount:1`, `netCentavos:47678`, `awaitingSettlementCount:0` |
| 4 | preview `userId=dd662c01-1a84-45d9-978c-2bef41a4032e` (OWN) | 200, `blocked.message` = `Esta é a conta do próprio afiliado` |
| 5 | preview `userId=bc81c244-2199-4172-b5d7-f79b39f93ef2` (EXISTING) | 200, `blocked.message` = `Já é indicado deste afiliado desde 19/08/2026` |
| 6 | preview `userId=nao-uuid` | 400 `Usuário inválido` |
| 7 | preview com `userId=00000000-0000-4000-8000-000000000000` | 404 `Usuário não encontrado` |
| 8 | preview em `$B/nao-uuid/customers/preview?userId=…A` | 404 `Afiliado não encontrado` |
| 9 | preview em `$B/00000000-0000-4000-8000-000000000000/customers/preview?userId=…A` | 404 `Afiliado não encontrado` |
| 10 | `POST $B/$AFF/customers` com `-H "Content-Type: application/json" --data 'isto não é json'` | 400 `Usuário inválido` |
| 11 | POST `{"userId":"…A","reason":"   "}` | 400 `Informe o motivo do vínculo (até 500 caracteres)` |
| 12 | POST `{"userId":"dd662c01-1a84-45d9-978c-2bef41a4032e","reason":"teste"}` (OWN) | 409 `Esta é a conta do próprio afiliado` |
| 13 | POST `{"userId":"bc81c244-2199-4172-b5d7-f79b39f93ef2","reason":"teste"}` (EXISTING) | 409 `Já é indicado deste afiliado desde 19/08/2026` |
| 14 | **POST A (escreve na staging)** `{"userId":"02b26403-9ce7-496d-b601-c7923ea88ea8","reason":"Verificação do vínculo manual (spec 2026-10-11) — Task 3"}` | 201 `{customerId, agreementId:"303350de-84bf-4d05-aa1c-ceb9c090701f", signedUpAt:<users.created_at de A>}`. **Se** A já estiver vinculado por uma execução anterior desta tarefa, o esperado é 409 `Já é indicado deste afiliado desde …` — registre e siga. |
| 15 | O mesmo POST A de novo (Review Focus 3) | 409 `Já é indicado deste afiliado desde DD/MM/AAAA` (a data é `users.created_at` de A em São Paulo) |
| 16 | `GET $B/$AFF/customers/preview?userId=…A` sem cookie (`curl -s -o /dev/null -w "%{http_code}"`) | 307 (o proxy manda para `/login`) |

- [ ] **Step 6: Confirm the rows written by #14 (read-only)**

Crie `BO/.scratch/rml/show-link.ts`:
```ts
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const url = process.env.POSTGRES_URL ?? "";
if (!url.includes("wsbsnzgzqiehqnklzchm")) {
  console.error("ABORT: não é a staging");
  process.exit(1);
}
const userId = process.argv[2];
const customers = await db.execute(sql`
  select id, affiliate_id, agreement_id, signed_up_at, created_at
  from referral_customers where user_id = ${userId}`);
const actions = await db.execute(sql`
  select admin_email, action, reason, details, created_at
  from referral_admin_actions
  where action = 'customer_linked' and details->>'userId' = ${userId}`);
const users = await db.execute(sql`select created_at from users where id = ${userId}`);
console.log(JSON.stringify({ customers: [...customers], actions: [...actions], userCreatedAt: [...users] }, null, 2));
process.exit(0);
```
Run: `cd "$BO" && APP_ENV=staging bun scripts/with-env.ts bun .scratch/rml/show-link.ts 02b26403-9ce7-496d-b601-c7923ea88ea8`
Expected: 1 `referral_customers` com `affiliate_id=26dcdc4f-…`, `agreement_id=303350de-…`, `signed_up_at` = `userCreatedAt`; 1 ação `customer_linked` com `admin_email=educacaoleg@gmail.com`, `details.customerId` = id do Indicado. Acrescente a saída a `EV/task3-api.txt`.

- [ ] **Step 7: Stop the dev server (P2.4) and commit**

```bash
git -C "$BO" add lib/referral/manual-link-queries.ts "app/api/referrals/[affiliateId]/customers/route.ts" "app/api/referrals/[affiliateId]/customers/preview/route.ts" docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/task3-api.txt
git -C "$BO" commit -m "feat(afiliados): rotas de prévia e de vínculo manual de indicado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Marca "vinculado manualmente" na lista do sheet

**Files:**
- Modify: `BO/lib/referral/customer-queries.ts`
- Modify: `BO/app/(admin)/referrals/affiliate-customers-sheet.tsx`
- Evidence: `EV/task4-customers-api.json`, `EV/task4-sheet-manual-marker.png`

**Interfaces:**
- Consumes (Task 2): `indexManualLinks`, `type ReferralCustomerManualLink`.
- Produces: `ReferralAffiliateCustomerItem.manualLink: ReferralCustomerManualLink | null` no JSON de `GET /api/referrals/[affiliateId]/customers` (consumido pela Task 5 e pelo sheet).

- [ ] **Step 1: Read the manual links in `getReferralAffiliateCustomers`**

Em `BO/lib/referral/customer-queries.ts`:
1. `import { and, desc, eq, sql } from "drizzle-orm";` (acrescente `and`).
2. Acrescente `referralAdminAction,` à lista importada de `@/lib/db/schema`.
3. Acrescente o import `import { indexManualLinks, type ReferralCustomerManualLink } from "./manual-link";`.
4. Em `ReferralAffiliateCustomerItem`, acrescente o campo:
```ts
  /** Vínculo feito por um admin no backoffice (auditoria `customer_linked`). */
  manualLink: ReferralCustomerManualLink | null;
```
5. Troque `const [customerRows, commissionRows] = await Promise.all([` por `const [customerRows, commissionRows, manualLinkRows] = await Promise.all([` e acrescente como terceiro elemento do array:
```ts
    db
      .select({
        details: referralAdminAction.details,
        adminEmail: referralAdminAction.adminEmail,
        createdAt: referralAdminAction.createdAt,
      })
      .from(referralAdminAction)
      .where(
        and(
          eq(referralAdminAction.affiliateId, affiliateId),
          eq(referralAdminAction.action, "customer_linked"),
        ),
      ),
```
6. Antes de `const customers = customerRows.map(`, acrescente `const manualLinks = indexManualLinks(manualLinkRows);` e, no objeto de cada Indicado (logo depois de `commission: summarizeReferralCustomerCommissions(...)`), acrescente `manualLink: manualLinks.get(row.id) ?? null,`.

- [ ] **Step 2: Render the marker in the sheet**

Em `BO/app/(admin)/referrals/affiliate-customers-sheet.tsx`, dentro da célula "Indicado" (o `<div className="min-w-0 max-w-[180px]">`), logo depois do `<div className="flex min-w-0 items-center gap-0.5">…</div>` do e-mail, acrescente:
```tsx
                            {customer.manualLink ? (
                              <p
                                className="truncate text-[11px] text-muted-foreground"
                                title={`Vinculado manualmente em ${formatNumericDateInSaoPaulo(customer.manualLink.linkedAt)} por ${customer.manualLink.adminEmail}`}
                                data-testid="manual-link-marker"
                              >
                                Vinculado manualmente em{" "}
                                {formatNumericDateInSaoPaulo(customer.manualLink.linkedAt)} por{" "}
                                {customer.manualLink.adminEmail}
                              </p>
                            ) : null}
```

- [ ] **Step 3: Lint + types**

Run: `cd "$BO" && bunx eslint lib/referral/customer-queries.ts "app/(admin)/referrals/affiliate-customers-sheet.tsx"` → exit 0.
Run: `cd "$BO" && bunx tsc --noEmit -p . 2>&1 | grep -E "customer-queries|affiliate-customers-sheet" ; echo "exit-grep $?"` → nenhuma linha.
Run: `cd "$BO" && bun test lib/referral/` → `0 fail`.

- [ ] **Step 4: Verify against staging (P1–P4)**

1. `curl -s -b "$C" http://localhost:3006/api/referrals/26dcdc4f-4c07-4dd2-b8f9-4e255d52af1f/customers > "$EV/task4-customers-api.json"` e confira: o Indicado de A (`user.email = rafaeliffeng+r1u1@gmail.com`) tem `manualLink: { linkedAt, adminEmail: "educacaoleg@gmail.com" }`; os outros 4 têm `manualLink: null`.
2. agent-browser (P4): `agent-browser click 'button[title="Ver indicados"]'`, `agent-browser wait 2500`, `agent-browser eval "document.querySelectorAll('[data-testid=manual-link-marker]').length"` → `1`; `agent-browser eval "document.querySelector('[data-testid=manual-link-marker]').textContent"` → começa com `Vinculado manualmente em ` e termina com `por educacaoleg@gmail.com`.
3. `agent-browser screenshot "$EV/task4-sheet-manual-marker.png"`. Feche a sessão (P4) e pare o server (P2.4).

- [ ] **Step 5: Commit**

```bash
git -C "$BO" add lib/referral/customer-queries.ts "app/(admin)/referrals/affiliate-customers-sheet.tsx" docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/task4-customers-api.json docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/task4-sheet-manual-marker.png
git -C "$BO" commit -m "feat(afiliados): marca de vínculo manual na lista de indicados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Diálogo "Vincular indicado" + botão no sheet + recarga da fila

**Files:**
- Create: `BO/app/(admin)/referrals/link-customer-dialog.tsx`
- Modify: `BO/app/(admin)/referrals/affiliate-customers-sheet.tsx`
- Modify: `BO/app/(admin)/referrals/page.tsx`
- Evidence: `EV/task5-*.png`, `EV/task5-checks.json`

**Interfaces:**
- Consumes: Task 2 (`describeManualLinkCharges`, `describeManualLinkQuota`, `MANUAL_LINK_REASON_MAX_LENGTH`), Task 3 (`type ManualLinkPreview`, rotas), `describeAgreementValue`/`describeAgreementDuration` de `@/lib/referral/agreement`, `GET /api/users/search?q=` (devolve um array de linhas de usuário; use só `id`, `email`, `name`).
- Produces:
  - `LinkCustomerDialog({ affiliate: { id: string; label: string }; open: boolean; onOpenChange: (open: boolean) => void; onLinked: () => void })`
  - `AffiliateCustomersTarget` ganha `status: ReferralAffiliateStatus`.
  - `AffiliateCustomersSheet` ganha a prop opcional `onCustomersChanged?: () => void`.

- [ ] **Step 1: Create the dialog**

`BO/app/(admin)/referrals/link-customer-dialog.tsx`:
```tsx
"use client";

// Vincular manualmente um cliente existente como Indicado deste afiliado
// (spec 2026-10-11, R2–R5). A prévia só informa a BASE do que o motor de
// comissão vai processar; quem decide é o POST, que relê tudo no servidor.

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  describeAgreementDuration,
  describeAgreementValue,
} from "@/lib/referral/agreement";
import {
  describeManualLinkCharges,
  describeManualLinkQuota,
  MANUAL_LINK_REASON_MAX_LENGTH,
} from "@/lib/referral/manual-link";
import type { ManualLinkPreview } from "@/lib/referral/manual-link-queries";

type SearchUser = { id: string; email: string; name: string | null };

const PREVIEW_ERROR = "Não foi possível carregar a prévia.";
const SUBMIT_ERROR = "Não foi possível vincular o indicado.";

export function LinkCustomerDialog({
  affiliate,
  open,
  onOpenChange,
  onLinked,
}: {
  affiliate: { id: string; label: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [selected, setSelected] = useState<SearchUser | null>(null);
  const [preview, setPreview] = useState<ManualLinkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Cada busca e cada prévia leva um número; resposta de um número antigo é
  // descartada. Sem isso, digitar rápido mostra o resultado de uma busca velha.
  const searchSeq = useRef(0);
  const previewSeq = useRef(0);

  const reset = () => {
    searchSeq.current += 1;
    previewSeq.current += 1;
    setQuery("");
    setResults([]);
    setSelected(null);
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setReason("");
    setSubmitError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const search = async (value: string) => {
    setQuery(value);
    // Editar a busca desfaz a escolha: nunca vincular alguém que não está na tela.
    previewSeq.current += 1;
    setSelected(null);
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setSubmitError(null);
    const seq = ++searchSeq.current;
    const term = value.trim();
    if (term.length < 3) {
      setResults([]);
      return;
    }
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(term)}`);
      if (!response.ok) throw new Error(String(response.status));
      const rows = (await response.json()) as SearchUser[];
      if (seq !== searchSeq.current) return;
      setResults(rows.map((row) => ({ id: row.id, email: row.email, name: row.name })));
    } catch {
      if (seq === searchSeq.current) setResults([]);
    }
  };

  const choose = async (candidate: SearchUser) => {
    searchSeq.current += 1;
    setSelected(candidate);
    setQuery(candidate.email);
    setResults([]);
    setPreview(null);
    setPreviewError(null);
    setSubmitError(null);
    const seq = ++previewSeq.current;
    setPreviewLoading(true);
    try {
      const response = await fetch(
        `/api/referrals/${affiliate.id}/customers/preview?userId=${encodeURIComponent(candidate.id)}`,
      );
      const payload = (await response.json().catch(() => ({}))) as
        | ManualLinkPreview
        | { error?: string };
      if (seq !== previewSeq.current) return;
      if (!response.ok) {
        setPreviewError(("error" in payload && payload.error) || PREVIEW_ERROR);
        return;
      }
      setPreview(payload as ManualLinkPreview);
    } catch {
      if (seq === previewSeq.current) setPreviewError(PREVIEW_ERROR);
    } finally {
      if (seq === previewSeq.current) setPreviewLoading(false);
    }
  };

  const trimmedReason = reason.trim();
  const canSubmit =
    selected !== null &&
    preview !== null &&
    preview.blocked === null &&
    !previewLoading &&
    trimmedReason.length > 0 &&
    trimmedReason.length <= MANUAL_LINK_REASON_MAX_LENGTH &&
    !submitting;

  const submit = async () => {
    if (!selected || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/referrals/${affiliate.id}/customers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selected.id, reason: trimmedReason }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setSubmitError(payload.error || SUBMIT_ERROR);
        return;
      }
      toast.success("Indicado vinculado", {
        description: "As cobranças pagas dele entram no cálculo da comissão em até 1 hora.",
      });
      reset();
      onOpenChange(false);
      onLinked();
    } catch {
      setSubmitError(SUBMIT_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  const quotaWarning =
    preview?.agreement && preview.blocked === null
      ? describeManualLinkQuota(preview.agreement, preview.charges.eligibleCount)
      : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vincular indicado</DialogTitle>
          <DialogDescription>
            Liga um cliente que já existe a {affiliate.label}. As cobranças pagas dele —
            inclusive as passadas — passam a gerar comissão pela regra do acordo.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-2">
          <Label htmlFor="link-customer-search">Cliente</Label>
          <Input
            id="link-customer-search"
            data-testid="link-customer-search"
            placeholder="Buscar por e-mail (mínimo 3 letras)"
            autoComplete="off"
            value={query}
            onChange={(event) => void search(event.target.value)}
          />
          {results.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border">
              {results.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  data-testid="link-customer-result"
                  className="flex w-full min-w-0 flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => void choose(candidate)}
                >
                  <span className="w-full truncate font-medium">{candidate.name || "—"}</span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {candidate.email}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <div
            className="min-w-0 rounded-md border p-3 text-sm"
            data-testid="link-customer-preview"
          >
            {previewLoading ? (
              <p className="text-muted-foreground">Carregando a prévia…</p>
            ) : previewError ? (
              <p className="text-destructive">{previewError}</p>
            ) : preview?.blocked ? (
              <p className="text-destructive" data-testid="link-customer-blocked">
                {preview.blocked.message}
              </p>
            ) : preview ? (
              <div className="space-y-1">
                <p className="font-medium" data-testid="link-customer-charges">
                  {describeManualLinkCharges(preview.charges)}
                </p>
                {preview.agreement && (
                  <p className="text-xs text-muted-foreground">
                    Acordo: {describeAgreementValue(preview.agreement)} ·{" "}
                    {describeAgreementDuration(preview.agreement)}
                  </p>
                )}
                {quotaWarning && (
                  <p className="text-xs text-warning" data-testid="link-customer-quota">
                    {quotaWarning}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  O valor de cada comissão é calculado pelo motor do programa em até 1 hora
                  e aparece na coluna Comissão.
                </p>
              </div>
            ) : null}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="link-customer-reason">Motivo</Label>
          <Textarea
            id="link-customer-reason"
            data-testid="link-customer-reason"
            placeholder="Ex.: veio pelo afiliado por WhatsApp e se cadastrou sem o link"
            maxLength={MANUAL_LINK_REASON_MAX_LENGTH}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Obrigatório. Fica na auditoria com o seu e-mail.
          </p>
        </div>

        {submitError && (
          <p className="text-sm text-destructive" data-testid="link-customer-error">
            {submitError}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            data-testid="link-customer-submit"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire the button into the sheet**

Em `BO/app/(admin)/referrals/affiliate-customers-sheet.tsx`:
1. Imports: `import { ExternalLink, UserPlus } from "lucide-react";`; `import type { ReferralAffiliateStatus, ReferralCommissionStatus } from "@/lib/db/schema";`; `import { LinkCustomerDialog } from "./link-customer-dialog";`.
2. `AffiliateCustomersTarget` ganha `status: ReferralAffiliateStatus;`.
3. Props do componente: acrescente `onCustomersChanged` (desestruturado) e no tipo `onCustomersChanged?: () => void;`.
4. Estado novo, logo abaixo de `const [data, setData] = …`:
```ts
  const [linkOpen, setLinkOpen] = useState(false);
  // Muda depois de um vínculo para o efeito abaixo recarregar a lista.
  const [reloadToken, setReloadToken] = useState(0);
```
5. Dependências do `useEffect` de carga: `}, [open, affiliateId, reloadToken]);`.
6. Depois de `const customers = data?.customers ?? [];` acrescente:
```ts
  // Só afiliado aprovado recebe indicado (spec D5). O status do servidor vence
  // o da fila, que pode estar desatualizado.
  const canLink = (data?.affiliate.status ?? target?.status) === "approved";
```
7. Troque o bloco `<SheetTitle …>…</SheetTitle>` + `<SheetDescription …>…</SheetDescription>` por:
```tsx
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0 space-y-1">
              <SheetTitle className="text-left text-base">
                Indicados de {title}
              </SheetTitle>
              <SheetDescription className="text-left">
                {target?.user.email}
                {target?.showCode ? ` · código ${target.code}` : ""}
              </SheetDescription>
            </div>
            {canLink && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                data-testid="link-customer-open"
                onClick={() => setLinkOpen(true)}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Vincular indicado
              </Button>
            )}
          </div>
```
8. Logo antes do `</SheetContent>` de fechamento, acrescente:
```tsx
        {target && (
          <LinkCustomerDialog
            affiliate={{ id: target.id, label: title }}
            open={linkOpen}
            onOpenChange={setLinkOpen}
            onLinked={() => {
              setReloadToken((token) => token + 1);
              onCustomersChanged?.();
            }}
          />
        )}
```

- [ ] **Step 3: Pass the status and the refresh from the page**

Em `BO/app/(admin)/referrals/page.tsx`:
1. No `onClick` do botão "Ver indicados", acrescente `status: row.status,` ao objeto passado para `setCustomersTarget`.
2. No `<AffiliateCustomersSheet … />`, acrescente `onCustomersChanged={fetchAffiliates}`.

- [ ] **Step 4: Lint + types**

Run: `cd "$BO" && bunx eslint "app/(admin)/referrals/link-customer-dialog.tsx" "app/(admin)/referrals/affiliate-customers-sheet.tsx" "app/(admin)/referrals/page.tsx"` → exit 0.
Run: `cd "$BO" && bunx tsc --noEmit -p . 2>&1 | grep -E "referrals/(link-customer-dialog|affiliate-customers-sheet|page)" ; echo "exit-grep $?"` → nenhuma linha.

- [ ] **Step 5: Verify in agent-browser against staging (P1–P4)**

Grave as checagens de `eval` em `EV/task5-checks.json` (um objeto por checagem: `{check, expected, actual, pass}`).

1. **Botão visível (aprovado):** abra o sheet (`agent-browser click 'button[title="Ver indicados"]'`, `wait 2500`); `agent-browser is visible '[data-testid=link-customer-open]'` → true. Screenshot `task5-button-approved.png`.
2. **Botão oculto (não aprovado):** feche o sheet (`agent-browser press Escape`, `wait 800`) e, sem recarregar, troque o `fetch` da página para que a lista de indicados devolva o afiliado como `blocked` (o sheet decide pelo status do servidor):
   ```bash
   agent-browser eval "(() => { const real = window.fetch.bind(window); window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url; const response = await real(input, init); if (!url.includes('/customers') || url.includes('/preview')) return response; const body = await response.json(); body.affiliate.status = 'blocked'; return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }; return 'patched'; })()"
   ```
   Reabra o sheet; `agent-browser eval "!!document.querySelector('[data-testid=link-customer-open]')"` → `false`. Screenshot `task5-button-hidden-blocked.png`. Depois recarregue a página (`agent-browser reload`), o que desfaz a troca, e confirme que o botão volta a aparecer.
3. **Prévia com zero cobranças (Z):** abra o sheet → clique `[data-testid=link-customer-open]` → `agent-browser fill '[data-testid=link-customer-search]' 'rafaeliffeng+r3k8'` → `wait 1500` → clique o primeiro `[data-testid=link-customer-result]` → `wait 1500`. `[data-testid=link-customer-charges]` deve ter o texto `Nenhuma cobrança paga até agora — só as próximas vão comissionar`; o botão `[data-testid=link-customer-submit]` fica desabilitado até digitar o motivo (`agent-browser is enabled …` → false). Screenshot `task5-preview-zero.png`.
4. **Prévia com líquido pendente (C):** busque `rafaeliffeng+r2ul4b` e escolha → texto `1 cobrança de assinatura paga · R$ 0,00 de líquido · 1 aguardando liquidação`. Screenshot `task5-preview-awaiting.png`.
5. **Bloqueio "já é indicado" (EXISTING):** busque `rafaeliffeng+u9@` e escolha → `[data-testid=link-customer-blocked]` = `Já é indicado deste afiliado desde 19/08/2026`; preencha o motivo e confirme que `submit` continua desabilitado. Screenshot `task5-blocked-existing.png`.
6. **Bloqueio conta própria (OWN):** busque `rafaeliffeng+u7@` → `Esta é a conta do próprio afiliado`. Screenshot `task5-blocked-own.png`.
7. **Review Focus 2 — seleção desfeita ao editar:** escolha B (`educacaoleg+001`), depois `agent-browser type '[data-testid=link-customer-search]' 'x'`; `eval "!!document.querySelector('[data-testid=link-customer-preview]')"` → false e `submit` desabilitado.
8. **Review Focus 1 — busca fora de ordem:** `agent-browser eval` que embrulha `window.fetch` para atrasar 1500 ms as respostas cujo URL contém `q=rafaeliffeng%2Br1u` e deixa as outras passarem; depois `fill` `rafaeliffeng+r1u` e imediatamente `fill` `rafaeliffeng+r3k8`; `wait 2500`; `eval "[...document.querySelectorAll('[data-testid=link-customer-result]')].map(b=>b.textContent)"` → só entradas com `r3k8`, nenhuma com `r1u1`.
9. **Vínculo de B pela UI (escreve na staging):** recarregue a página (desfaz o embrulho do fetch), abra o sheet → diálogo → busque `educacaoleg+001` → escolha → texto `1 cobrança de assinatura paga · R$ 476,78 de líquido` (screenshot `task5-preview-b.png`) → `fill '[data-testid=link-customer-reason]' 'Verificação do vínculo manual (spec 2026-10-11) — Task 5'` → clique `submit`. Esperado: o diálogo fecha, o toast `Indicado vinculado` aparece, o sheet recarrega, B aparece com `[data-testid=manual-link-marker]`, e o resumo do cabeçalho mostra `6 indicados` (4 originais + A + B). `wait 2500` e screenshot `task5-linked-b.png`. Feche o sheet e confira que a célula da fila agora diz `6 indicados` (`agent-browser eval "document.body.innerText.includes('6 indicados')"` → true). **Se** B já estiver vinculado por uma execução anterior, a prévia mostra `Já é indicado deste afiliado desde …` — registre no `task5-checks.json` e siga.
10. **Celular:** `agent-browser set viewport 375 812`, recarregue, abra o sheet e o diálogo, busque `rafaeliffeng+r3k8` e escolha; `eval "document.documentElement.scrollWidth <= window.innerWidth"` → true e `eval "(()=>{const d=document.querySelector('[role=dialog] [data-testid=link-customer-preview]').closest('[role=dialog]');return d.scrollWidth<=d.clientWidth})()"` → true. Screenshot `task5-dialog-mobile.png`. Volte a `1440 900`.

Feche a sessão (P4) e pare o server (P2.4).

- [ ] **Step 6: Commit**

```bash
git -C "$BO" add "app/(admin)/referrals/link-customer-dialog.tsx" "app/(admin)/referrals/affiliate-customers-sheet.tsx" "app/(admin)/referrals/page.tsx" docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/
git -C "$BO" commit -m "feat(afiliados): diálogo para vincular indicado manualmente no sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ponta a ponta do dinheiro — o motor comissiona A e B corretamente (R12, R13)

**Files:**
- Create (não versionado, `FE/scripts/` é ignorado): `FE/scripts/_rml-verify-commissions.ts`
- Create (cópia versionada para reprodução): `EV/support/_rml-verify-commissions.ts`
- Evidence: `EV/task6-engine.json`, `EV/task6-sheet-commissions.png`

**Interfaces:**
- Consumes: Tasks 3 e 5 (A e B já são Indicados do VINDITESTE na staging). Do FE (sem alterar): `processReferralCommissionForPayment(paymentId, { now? })` de `@/lib/referral/commission-service`, `findPaymentsPendingCommission(limit)` de `@/lib/referral/queries`, `db` de `@/lib/db/executor`, `loadAppEnv` de `@/lib/env/load-env` (confira o caminho e o nome exatos lendo as linhas 28–52 de `FE/scripts/verify-commission-engine-staging.ts` e copie aquele cabeçalho).
- Produces: evidência de que cada comissão = `Math.round(líquido × bps / 10000)` e que o sheet mostra os valores.

> **Não** chame `runReferralCommissionEngine()` nem o cron `/api/cron-job/billing/reconcile-settlements`: a varredura processaria outros indicados da staging e o cron consulta Stripe/Mercado Pago de verdade. Chamar `processReferralCommissionForPayment` para os pagamentos de A e B é exatamente o que a varredura faria por eles.

- [ ] **Step 1: Write the verification script**

`FE/scripts/_rml-verify-commissions.ts` — copie o cabeçalho de carga de env + guarda de staging das linhas 28–52 de `FE/scripts/verify-commission-engine-staging.ts` (ele chama `loadAppEnv()`, exige `APP_ENV === "staging"` e que `POSTGRES_URL` contenha `wsbsnzgzqiehqnklzchm`, abortando caso contrário) e então:
```ts
// (cabeçalho copiado: loadAppEnv + asserts de staging)
import { writeFileSync } from "node:fs";

const [outputPath, ...userIds] = process.argv.slice(2);
if (!outputPath || userIds.length === 0) {
  console.error("uso: _rml-verify-commissions.ts <saida.json> <userId...>");
  process.exit(1);
}

const { sql } = await import("drizzle-orm");
const { db } = await import("@/lib/db/executor");
const { findPaymentsPendingCommission } = await import("@/lib/referral/queries");
const { processReferralCommissionForPayment } = await import("@/lib/referral/commission-service");

type Row = Record<string, unknown>;
const rows = async (query: ReturnType<typeof sql>) => [...(await db.execute(query))] as Row[];

const report: Row[] = [];
let failures = 0;

const pending = new Set(await findPaymentsPendingCommission(1000));

for (const userId of userIds) {
  const [customer] = await rows(sql`
    select c.id, c.affiliate_id, a.percentage_bps, a.fixed_amount_centavos, a.format
    from referral_customers c join referral_agreements a on a.id = c.agreement_id
    where c.user_id = ${userId}`);
  if (!customer) {
    failures += 1;
    report.push({ userId, error: "não é indicado" });
    continue;
  }
  const eligible = await rows(sql`
    select id, net_amount from payments
    where user_id = ${userId} and status = 'succeeded'
      and (purpose is null or purpose = 'subscription')
      and external_id is not null and coalesce(gross_amount, amount) > 0
    order by created_at asc`);

  for (const paymentRow of eligible) {
    const paymentId = String(paymentRow.id);
    const pickedBySweep = pending.has(paymentId);
    // Numa nova tentativa desta tarefa a comissão já existe e o pagamento saiu
    // da fila da varredura — isso também é sucesso, não falha.
    const [before] = await rows(sql`
      select rc.id from referral_commissionable_events e
      join referral_commissions rc on rc.event_id = e.id
      where e.payment_id = ${paymentId}`);
    const existedBefore = Boolean(before);
    const first = await processReferralCommissionForPayment(paymentId);
    const second = await processReferralCommissionForPayment(paymentId);
    const [commission] = await rows(sql`
      select rc.id, rc.amount_centavos, rc.status, rc.releases_at, rc.agreement_snapshot,
             e.status as event_status, e.net_centavos, e.kind,
             (select count(*)::int from referral_ledger_entries l where l.commission_id = rc.id) as ledger_entries
      from referral_commissionable_events e
      left join referral_commissions rc on rc.event_id = e.id
      where e.payment_id = ${paymentId}`);
    const net = paymentRow.net_amount === null ? null : Number(paymentRow.net_amount);
    const expected =
      net === null
        ? null
        : customer.format === "fixed"
          ? Number(customer.fixed_amount_centavos)
          : Math.round((net * Number(customer.percentage_bps)) / 10_000);
    const actual = commission?.amount_centavos == null ? null : Number(commission.amount_centavos);
    const pass =
      (pickedBySweep || existedBefore) &&
      second.created === false &&
      (expected === null
        ? commission?.event_status === "awaiting_settlement"
        : actual === expected && Number(commission?.ledger_entries) === 1);
    if (!pass) failures += 1;
    report.push({ userId, paymentId, pickedBySweep, existedBefore, net, expected, actual, first, secondCreated: second.created, commission, pass });
  }
}

writeFileSync(outputPath, JSON.stringify({ ranAt: new Date().toISOString(), failures, report }, null, 2));
console.log(JSON.stringify({ failures, checked: report.length }));
process.exit(failures === 0 ? 0 : 1);
```
Copie o arquivo final para `EV/support/_rml-verify-commissions.ts`.

- [ ] **Step 2: Run it against staging (escreve eventos, comissões e lançamentos na staging)**

Run: `cd "$FE" && APP_ENV=staging bun scripts/with-env.ts bun --conditions=react-server scripts/_rml-verify-commissions.ts "$EV/task6-engine.json" 02b26403-9ce7-496d-b601-c7923ea88ea8 0f0f625d-0c02-488a-b75b-fa647eb00ec4`
Expected: `{"failures":0,"checked":2}`, exit 0. Em `task6-engine.json`, para cada um dos dois pagamentos: `pickedBySweep: true` (na primeira execução), `expected: 9536`, `actual: 9536`, `commission.status: "foreseen"`, `event_status: "settled"`, `ledger_entries: 1`, `secondCreated: false`. Numa nova tentativa, `existedBefore: true`, `pickedBySweep: false` e `first.created: false` — o resto continua valendo; registre qual foi o caso.

- [ ] **Step 3: Sheet shows the commissions (agent-browser, P1–P4)**

Abra o sheet do VINDITESTE: as linhas de A e B mostram `R$ 95,36` na coluna Comissão com `Prevista R$ 95,36` embaixo; o resumo do cabeçalho mostra `R$ 190,72 em comissão`. Confirme com `agent-browser eval "document.querySelector('[role=dialog]').innerText.includes('R$ 190,72 em comissão')"` → true. Screenshot `EV/task6-sheet-commissions.png`. Feche a sessão e pare o server.

- [ ] **Step 4: Commit**

```bash
git -C "$BO" add docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/
git -C "$BO" commit -m "test(afiliados): evidência ponta a ponta do motor sobre indicados vinculados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verificação final — suítes, lint, tipos e índice de evidências

**Files:**
- Create: `EV/README.md`, `EV/task7-suites.md`
- Create (não versionado): `BO/.scratch/rml/junit-failures.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–6; `SP/bo-base.xml`, `SP/fe-base.xml`.

- [ ] **Step 1: Full suites with junit**

Rode as duas suítes completas (comandos de Global Constraints) acrescentando `--reporter=junit --reporter-outfile="$SP/bo-branch.xml"` (BO) e `--reporter=junit --reporter-outfile="$SP/fe-branch.xml"` (FE), guardando o rodapé (`pass`/`fail`/`errors`).

- [ ] **Step 2: Compare failures by name against the baseline**

`BO/.scratch/rml/junit-failures.ts`:
```ts
import { readFileSync } from "node:fs";

const xml = readFileSync(process.argv[2], "utf8");
const failing = new Set<string>();
for (const chunk of xml.split("<testcase").slice(1)) {
  const tagEnd = chunk.indexOf(">");
  const tag = chunk.slice(0, tagEnd);
  const close = chunk.indexOf("</testcase>");
  const body = tag.endsWith("/") ? "" : chunk.slice(tagEnd, close === -1 ? undefined : close);
  if (!/<failure|<error/.test(body)) continue;
  const name = /\sname="([^"]*)"/.exec(tag)?.[1] ?? "?";
  const classname = /\sclassname="([^"]*)"/.exec(tag)?.[1] ?? "";
  failing.add(`${classname} :: ${name}`);
}
console.log([...failing].sort().join("\n"));
```
Run, para cada repo (`bo`, `fe`):
```bash
cd "$BO"
bun .scratch/rml/junit-failures.ts "$SP/bo-base.xml" > "$SP/bo-base-fail.txt"
bun .scratch/rml/junit-failures.ts "$SP/bo-branch.xml" > "$SP/bo-branch-fail.txt"
comm -13 "$SP/bo-base-fail.txt" "$SP/bo-branch-fail.txt"   # falhas NOVAS — esperado: vazio
```
Expected: nenhuma falha nova nos dois repos; BO `pass` = 1835 + testes novos (paridade + `manual-link.test.ts`); FE `pass` = 3659. Escreva `EV/task7-suites.md` com os rodapés base × branch e a saída dos `comm` (vazia = "nenhuma falha nova"). Se aparecer falha nova, investigue e corrija antes de seguir — não a descreva como "alheia" sem rodá-la isolada na base e na branch.

- [ ] **Step 3: Lint and types on every touched file**

```bash
cd "$BO" && bunx eslint lib/referral/manual-link.ts lib/referral/manual-link.test.ts lib/referral/manual-link-queries.ts lib/referral/customer-queries.ts "app/api/referrals/[affiliateId]/customers/route.ts" "app/api/referrals/[affiliateId]/customers/preview/route.ts" "app/(admin)/referrals/link-customer-dialog.tsx" "app/(admin)/referrals/affiliate-customers-sheet.tsx" "app/(admin)/referrals/page.tsx" tests/referral-admin-action-parity.test.ts
cd "$BO" && bunx tsc --noEmit -p . 2>&1 | grep -E "manual-link|customer-queries|referrals/|referral-admin-action-parity|lib/db/schema.ts" ; echo "exit-grep $?"
cd "$FE" && bunx tsc --noEmit -p . 2>&1 | grep -E "lib/db/schema.ts" ; echo "exit-grep $?"; git -C "$FE" checkout -- tsconfig.tsbuildinfo 2>/dev/null; true
```
Expected: eslint exit 0; os dois grep sem linhas. Acrescente os resultados a `EV/task7-suites.md`.

- [ ] **Step 4: Evidence index**

`EV/README.md`: uma tabela "requisito da spec → arquivo de evidência / teste" cobrindo R1–R14 (ex.: R1 → `task5-button-approved.png`, `task5-button-hidden-blocked.png`; R7 → `task3-api.txt` linhas 6–16 + `manual-link.test.ts`; R13 → `task6-engine.json`, `task6-sheet-commissions.png`; R14 → `task7-suites.md`), mais a lista de escritas feitas na staging (A e B vinculados, 2 eventos, 2 comissões, 2 lançamentos) com os ids de `task3-api.txt` e `task6-engine.json`.

- [ ] **Step 5: Clean up secrets and scratch**

```bash
rm -f "$SP/rml-session.token"
rm -rf "$BO/.scratch/rml"
git -C "$BO" status --short   # só os arquivos de evidência novos
git -C "$FE" status --short   # vazio (o script de verificação fica em scripts/, ignorado)
```

- [ ] **Step 6: Commit**

```bash
git -C "$BO" add docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/README.md docs/superpowers/plans/2026-10-11-referral-manual-customer-link/evidence/task7-suites.md
git -C "$BO" commit -m "docs(afiliados): índice de evidências do vínculo manual de indicado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (feito pelo autor do plano)

1. **Cobertura da spec:** R1 → T5 (botão + oculto); R2–R4 → T5 (busca, prévia, motivo); R5–R6 → T4/T5 (marca + recarga da fila); R7 → T2 (regras) + T3 (rota, curl 6–16); R8 → T3 (transação + leitura das linhas); R9 → T3 (prévia + cortes); R10 → T4; R11 → T1; R12–R13 → T6; R14 → T7. D1–D10 refletidos em T2/T3. Sem lacunas.
2. **Placeholders:** nenhum "TBD"/"similar a". O único passo que copia código existente (cabeçalho de env do script do FE, T6) aponta arquivo e linhas exatos, porque copiar à mão um guard de produção errado é o risco maior.
3. **Consistência de tipos:** `ManualLinkState`, `ManualLinkDecision`, `ManualLinkCharges`, `ManualLinkPreview`, `ManualLinkResult`, `ReferralCustomerManualLink`, `AffiliateCustomersTarget.status`, `onCustomersChanged` — mesmos nomes em todas as tarefas.
4. **Review Focus:** 5 itens, cada um com checagem na tarefa dona (T2 testes, T3 curl 10/15, T5 passos 7–8 e clique único por `disabled` durante envio).

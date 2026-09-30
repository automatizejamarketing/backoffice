# Saldo / fatura da conta de anúncios Meta no perfil do usuário — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na aba Marketing do perfil do cliente no backoffice, mostrar o saldo (pré-paga) ou a fatura em aberto (pós-paga) e o status da conta de anúncios Meta selecionada, com a mesma regra do app do cliente.

**Architecture:** Um leitor só do backoffice (`readAdAccountMoney`) faz um `GET act_<id>` na Graph com o token do cliente, degrada para leitura só de identidade quando a Meta recusa os campos de dinheiro, e reaproveita as funções espelhadas `resolveAdAccountMoney` / `isAdAccountMoneyBlockedByPermission`. Uma rota `GET /api/users/[id]/ad-accounts/[accountId]/money` (handler com dependências injetadas) expõe o resultado; um card cliente com react-query renderiza o que a função pura `describeAdAccountMoney` decide.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, @tanstack/react-query 5, shadcn/ui (new-york), lucide-react, sonner, Bun (`bun test` com `bun:test`), agent-browser 0.38 para verificação de UI.

**Spec:** `docs/superpowers/specs/2026-09-30-meta-ad-account-money-design.md` (leia antes de começar; os IDs R1–R17 da matriz de aceitação são citados nas tarefas).

## Global Constraints

- **Repositório:** só o `backoffice`, na worktree `D:\automatize-marketing\backoffice-meta-ad-account-money`, branch `feat/backoffice-meta-ad-account-money`. Nenhum arquivo de `D:\automatize-marketing\automatize-frontend` pode ser alterado (R17).
- **Arquivos espelhados são intocáveis:** não edite nada em `lib/meta-business/marketing/` (inclui `ad-account-money.ts`), `duplicate.ts`, `creative-features.ts`, `write-retry.ts`, `object-busy.ts`, `meta-asset-policy.ts`, `schedule-shape.ts`, `cbo-dayparting-release.ts`, `get-instagram-connected-page.ts`, `messaging.ts`. Só importe deles.
- **Testes:** `bun:test` (`import { describe, expect, test } from "bun:test"`), herméticos, colocados ao lado do arquivo (`*.test.ts`). Nunca use `mock.module` (é global e vaza entre arquivos): injete dependências ou use `installMetaFetchStub` de `@/tests/helpers/meta-fetch-stub`.
- **Suíte inteira:** `FRONTEND_ROOT=D:/automatize-marketing/automatize-frontend bun test`. Baseline em `94f68eb`: **1428 pass / 8 fail**. As 8 falhas pré-existentes (não conserte, não conte como regressão): "CRM contact filters…", "grant concurrency…", "settings persist…", "expiration and audit remain atomic…", "pool preserves transactions…" (precisam do Postgres `:55432`, Docker desligado) e "journal de migrations > não estreia colisão de `when`…", "journal de migrations > gêmeas byte-idênticas…", "both apps share the tag migration and timestamp" (drift entre repos). `bun test tests/` pula os testes colocados — rode sempre `bun test` sem caminho para a suíte inteira.
- **Lint/build (baseline em `94f68eb`):** `bun run lint` já sai 1 com 174 problemas (58 errors, 116 warnings) em arquivos alheios; `bun run build` passa. Portão de lint desta branch = `bunx eslint <arquivos criados/alterados>`: arquivos novos com 0 problemas; `marketing-workspace.tsx` + `read-cache.ts` + `insights/account.ts` juntos continuam com exatamente **5 problems (4 errors, 1 warning)** (os pré-existentes de setState-em-effect do workspace). Baseline completa em `.scratch/meta-ad-account-money/baseline-lint.txt`.
- **Banco:** nenhuma migração, nenhum comando que escreva em banco. `bun dev` aponta para `:55432` (fora do ar); a verificação de UI usa `bun dev:staging` (só leitura). Scripts que tocam banco rodam via `bun scripts/with-env.ts` com `APP_ENV=staging` e só fazem `SELECT`.
- **Textos exatos (pt-BR), copiar literalmente:**
  - subtítulo `Saldo / fatura na Meta`
  - `Pré-paga`, `Pós-paga`, `Saldo disponível`, `Fatura em aberto`, `Saldo indisponível`
  - BISU: `A Meta só mostra o saldo para integrações com acesso de administrador. Peça ao cliente para conceder controle total (Administrador) desta conta de anúncios à Automatize no Gerenciador de Negócios e reconectar.`
  - usuário: `A Meta não devolveu o saldo para quem conectou esta conta — provavelmente não é administrador dela.`
  - sem valor: `A Meta não informou saldo nem fatura para esta conta.`
  - carregando `Consultando a Meta…`; erro `Não foi possível consultar o saldo`; botões `Tentar de novo`, `Atualizar`; rodapé `Atualizado às HH:mm`
  - 400: `{ error: "invalid_account_id", message: "Conta de anúncios inválida." }`
- **Rótulos de status (mapa existente `ACCOUNT_STATUS_PT`):** 1 Ativa, 2 Desativada, 3 Não quitada, 7 Em revisão de risco, 8 Aguardando pagamento, 9 Em período de carência, 100 Fechamento pendente, 101 Fechada, outro → Desconhecida.
- **Cache:** TTL 5 min, chave `acctmoney:<tokenCacheId>:<dígitos da conta>`.
- **Commits:** mensagens em pt-BR no estilo `tipo(escopo): descrição`, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Não faça push. Nunca use `git stash` sem `-m` único.
- **Shell:** Git Bash no Windows; use caminhos com `/`.

## Review Focus

1. **`act_123` e `123` são a mesma conta:** as duas formas devem cair na mesma entrada de cache e gerar uma única chamada à Graph → teste na Task 2 ("act_ e dígitos compartilham o cache").
2. **Pós-paga com `balance` "0":** tem que virar "Fatura em aberto R$ 0,00", não "sem valor" → testes na Task 2 ("balance zero é fatura de zero") e Task 4 ("fatura zero formata R$ 0,00").
3. **Pré-paga com `display_string` só de espaços:** não é saldo legível → `blocked` → teste na Task 2 ("display_string em branco é bloqueio").
4. **Trocar de conta durante um "Atualizar" em voo:** o dado novo tem que cair na conta atualizada, nunca na recém-selecionada → teste na Task 5 (`refreshAdAccountMoney` grava só na chave da própria conta).
5. **"Atualizar" sob rate limit da Meta:** a leitura forçada serve o valor em cache com o `fetchedAt` original (o rodapé não finge frescor) → teste na Task 2 ("fresh sob rate limit mantém o fetchedAt antigo").

---

### Task 1: Opção `forceRefresh` no cache de leituras Meta

**Files:**
- Modify: `lib/meta-business/read-cache.ts` (tipo `CachedMetaReadArgs` ~linhas 84-99 e função `cachedMetaRead` ~linhas 105-148)
- Create: `lib/meta-business/read-cache.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `CachedMetaReadArgs<T>` ganha `forceRefresh?: boolean`; `cachedMetaRead(args)` mantém a assinatura. Usado pela Task 2.

- [ ] **Step 1: Escrever os testes que falham**

Crie `lib/meta-business/read-cache.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";

import { cachedMetaRead, resetMetaReadCacheForTests } from "./read-cache";

/** Erro no formato que `isMetaRateLimitError` reconhece (código 17 = throttle de usuário). */
function rateLimitError() {
  return Object.assign(new Error("throttled"), {
    errorReturn: { statusCode: 400, data: { code: 17 } },
  });
}

function counter(values: unknown[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fetcher: async () => values[Math.min(calls++, values.length - 1)],
  };
}

beforeEach(() => {
  resetMetaReadCacheForTests();
});

describe("cachedMetaRead", () => {
  test("sem forceRefresh, a segunda leitura dentro do TTL vem do cache", async () => {
    const c = counter(["v1", "v2"]);
    expect(await cachedMetaRead({ key: "k1", ttlMs: 60_000, fetcher: c.fetcher })).toBe("v1");
    expect(await cachedMetaRead({ key: "k1", ttlMs: 60_000, fetcher: c.fetcher })).toBe("v1");
    expect(c.calls).toBe(1);
  });

  test("forceRefresh ignora a entrada fresca e grava o valor novo", async () => {
    const c = counter(["v1", "v2"]);
    await cachedMetaRead({ key: "k2", ttlMs: 60_000, fetcher: c.fetcher });
    expect(
      await cachedMetaRead({ key: "k2", ttlMs: 60_000, fetcher: c.fetcher, forceRefresh: true }),
    ).toBe("v2");
    // A leitura seguinte, sem a flag, já enxerga o valor novo.
    expect(await cachedMetaRead({ key: "k2", ttlMs: 60_000, fetcher: c.fetcher })).toBe("v2");
    expect(c.calls).toBe(2);
  });

  test("forceRefresh sob rate limit serve a entrada existente", async () => {
    await cachedMetaRead({ key: "k3", ttlMs: 60_000, fetcher: async () => "antigo" });
    const value = await cachedMetaRead({
      key: "k3",
      ttlMs: 60_000,
      forceRefresh: true,
      fetcher: async () => {
        throw rateLimitError();
      },
    });
    expect(value).toBe("antigo");
  });

  test("forceRefresh com erro que não é rate limit propaga o erro", async () => {
    await cachedMetaRead({ key: "k4", ttlMs: 60_000, fetcher: async () => "antigo" });
    await expect(
      cachedMetaRead({
        key: "k4",
        ttlMs: 60_000,
        forceRefresh: true,
        fetcher: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
  });

  test("duas leituras forçadas concorrentes fazem uma chamada só", async () => {
    const c = counter(["v1"]);
    const [a, b] = await Promise.all([
      cachedMetaRead({ key: "k5", ttlMs: 60_000, fetcher: c.fetcher, forceRefresh: true }),
      cachedMetaRead({ key: "k5", ttlMs: 60_000, fetcher: c.fetcher, forceRefresh: true }),
    ]);
    expect([a, b]).toEqual(["v1", "v1"]);
    expect(c.calls).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bun test lib/meta-business/read-cache.test.ts`
Expected: FAIL em "forceRefresh ignora a entrada fresca…" (devolve `"v1"`), e erro de tipo/propriedade desconhecida não impede a execução do bun. Os testes 1, 3, 4 e 5 podem já passar.

- [ ] **Step 3: Implementar**

Em `lib/meta-business/read-cache.ts`, acrescente ao tipo `CachedMetaReadArgs<T>` (depois de `fetcher`):

```ts
  /**
   * Ignora a entrada FRESCA da L1 e vai à Meta (o botão "Atualizar" do card de
   * saldo). Continua juntando chamadas concorrentes iguais, grava o resultado
   * novo e, sob rate limit, ainda serve a entrada existente. Default: false.
   */
  forceRefresh?: boolean;
```

E em `cachedMetaRead`, troque a desestruturação e o retorno da L1:

```ts
  const { key, ttlMs, fetcher, forceRefresh = false } = args;
  const staleMs = args.staleMs ?? ttlMs * 6;
  const now = Date.now();

  const fromMemory = readMemory<T>(key, now);
  if (!forceRefresh && fromMemory && fromMemory.freshUntil > now) {
    return fromMemory.value;
  }
```

O resto da função fica como está (o `fromMemory` continua sendo o valor servido sob throttle, fresco ou velho).

- [ ] **Step 4: Rodar e ver passar**

Run: `bun test lib/meta-business/read-cache.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/meta-business/read-cache.ts lib/meta-business/read-cache.test.ts
git commit -m "feat(meta): forceRefresh no cache de leituras da Graph

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tipos, rótulo de status e leitor `readAdAccountMoney`

**Files:**
- Create: `lib/backoffice/ad-account-money-types.ts`
- Modify: `lib/meta-business/insights/account.ts` (exportar `getAccountStatusLabel`, usar em `fetchAccountContext` ~linhas 143-146)
- Create: `lib/meta-business/insights/account-status-label.test.ts`
- Create: `lib/meta-business/ad-account-money-read.ts`
- Create: `lib/meta-business/ad-account-money-read.test.ts`

**Interfaces:**
- Consumes: `cachedMetaRead` com `forceRefresh` (Task 1); `callMeta` de `@/lib/meta-business/insights/client`; `withActPrefix` de `@/lib/meta-business/account-match`; `GraphApiError` de `@/lib/meta-business/error`; `resolveAdAccountMoney`, `isAdAccountMoneyBlockedByPermission` de `@/lib/meta-business/marketing/ad-account-money` (espelhado, só importar); `tokenCacheId` de `@/lib/meta-business/read-cache`.
- Produces:
  - `lib/backoffice/ad-account-money-types.ts`: `AdAccountMoneyState`, `AdAccountMoneyRead`, `AdAccountMoneyConnectionKind`, `AdAccountMoneyResponse`, `AdAccountMoneyErrorResponse` (código abaixo).
  - `getAccountStatusLabel(status: number): string` em `lib/meta-business/insights/account.ts`.
  - `readAdAccountMoney(args: { adAccountId: string; accessToken: string; fresh?: boolean }): Promise<AdAccountMoneyRead>` e `isMoneyFieldRejection(error: unknown): boolean` em `lib/meta-business/ad-account-money-read.ts`.

- [ ] **Step 1: Criar os tipos compartilhados**

Crie `lib/backoffice/ad-account-money-types.ts` (arquivo puro, sem import de runtime, seguro para o bundle do cliente):

```ts
import type { ReconnectInfo } from "@/lib/meta-business/reconnect-link";

/**
 * O dinheiro da conta de anúncios, na regra do app do cliente
 * (`lib/meta-business/marketing/ad-account-money.ts`, espelhado):
 * - `available`: pré-paga — `funding_source_details.display_string`, sem alterar;
 * - `owed`: pós-paga — `balance / 100`, a "Fatura em aberto" (dívida, não saldo);
 * - `blocked`: a Meta escondeu os campos por permissão (tarefa MANAGE/ADVERTISE);
 * - `none`: não há valor para mostrar.
 */
export type AdAccountMoneyState =
  | { kind: "available"; display: string }
  | { kind: "owed"; amountMajor: number }
  | { kind: "blocked" }
  | { kind: "none" };

export type AdAccountMoneyRead = {
  /** Só dígitos, sem `act_`. */
  adAccountId: string;
  name: string | null;
  /** Código ISO da moeda da conta (ex.: "BRL"). */
  currency: string | null;
  /** null quando a Meta não devolveu `is_prepay_account`. */
  isPrepaid: boolean | null;
  money: AdAccountMoneyState;
  accountStatus: number | null;
  /** null quando `accountStatus` é null. */
  accountStatusLabel: string | null;
  /** ISO 8601 do momento da leitura real na Meta (um valor do cache mantém a hora original). */
  fetchedAt: string;
};

export type AdAccountMoneyConnectionKind = "bisu" | "user";

/** Corpo 200 de `GET /api/users/[id]/ad-accounts/[accountId]/money`. */
export type AdAccountMoneyResponse = AdAccountMoneyRead & {
  connectionKind: AdAccountMoneyConnectionKind;
};

/** Corpo de erro da mesma rota — o formato do `/api/users/[id]/ad-accounts`. */
export type AdAccountMoneyErrorResponse = {
  error: string;
  message: string;
  solution?: string;
  correlationId?: string;
  code?: number;
  errorSubcode?: number;
  needsReconnect?: boolean;
  reconnect?: ReconnectInfo;
};
```

- [ ] **Step 2: Teste que falha para `getAccountStatusLabel`**

Crie `lib/meta-business/insights/account-status-label.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { getAccountStatusLabel } from "./account";

describe("getAccountStatusLabel", () => {
  test("mapeia os status da Meta para os rótulos do app", () => {
    expect(getAccountStatusLabel(1)).toBe("Ativa");
    expect(getAccountStatusLabel(2)).toBe("Desativada");
    expect(getAccountStatusLabel(3)).toBe("Não quitada");
    expect(getAccountStatusLabel(7)).toBe("Em revisão de risco");
    expect(getAccountStatusLabel(8)).toBe("Aguardando pagamento");
    expect(getAccountStatusLabel(9)).toBe("Em período de carência");
    expect(getAccountStatusLabel(100)).toBe("Fechamento pendente");
    expect(getAccountStatusLabel(101)).toBe("Fechada");
  });

  test("status fora do mapa vira Desconhecida", () => {
    expect(getAccountStatusLabel(0)).toBe("Desconhecida");
    expect(getAccountStatusLabel(999)).toBe("Desconhecida");
  });
});
```

Run: `bun test lib/meta-business/insights/account-status-label.test.ts`
Expected: FAIL — `getAccountStatusLabel` não é exportado.

- [ ] **Step 3: Exportar `getAccountStatusLabel`**

Em `lib/meta-business/insights/account.ts`, logo depois do objeto `ACCOUNT_STATUS_PT`, acrescente:

```ts
/**
 * Rótulo pt-BR do `account_status` da Meta — os mesmos textos de
 * `messages/pt-BR.json` (`accountStatus`) do app do cliente.
 */
export function getAccountStatusLabel(status: number): string {
  return ACCOUNT_STATUS_PT[status] ?? "Desconhecida";
}
```

E em `fetchAccountContextUncached`, troque o cálculo de `accountStatusLabel` por:

```ts
    accountStatusLabel:
      raw.account_status != null
        ? getAccountStatusLabel(raw.account_status)
        : "Desconhecida",
```

Run: `bun test lib/meta-business/insights/account-status-label.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 4: Testes que falham para o leitor**

Crie `lib/meta-business/ad-account-money-read.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  ensureMetaTestEnv,
  graphErrorBody,
  installMetaFetchStub,
  rateLimitHeaders,
  type MetaFetchStub,
} from "@/tests/helpers/meta-fetch-stub";
import { resetMetaReadCacheForTests } from "./read-cache";
import { readAdAccountMoney } from "./ad-account-money-read";

const FULL_FIELDS =
  "name,currency,account_status,balance,is_prepay_account,funding_source_details{display_string}";
const IDENTITY_FIELDS = "name,currency,account_status";

ensureMetaTestEnv();
let stub: MetaFetchStub | undefined;
let tokenSeq = 0;
/** Token novo por teste: a chave do cache inclui o hash do token. */
const nextToken = () => `tok-${++tokenSeq}`;

beforeEach(() => {
  resetMetaReadCacheForTests();
});
afterEach(() => {
  stub?.restore();
  stub = undefined;
});

describe("readAdAccountMoney", () => {
  test("pré-paga devolve o display_string da Meta sem alterar", async () => {
    stub = installMetaFetchStub(() => ({
      body: {
        id: "act_123",
        name: "Loja Centro",
        currency: "BRL",
        account_status: 1,
        is_prepay_account: true,
        balance: "245",
        funding_source_details: { display_string: "R$ 15,63" },
      },
    }));
    const read = await readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() });
    expect(read).toMatchObject({
      adAccountId: "123",
      name: "Loja Centro",
      currency: "BRL",
      isPrepaid: true,
      money: { kind: "available", display: "R$ 15,63" },
      accountStatus: 1,
      accountStatusLabel: "Ativa",
    });
    expect(Number.isNaN(Date.parse(read.fetchedAt))).toBe(false);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].method).toBe("GET");
    expect(stub.calls[0].path).toBe("act_123");
    expect(stub.calls[0].params.get("fields")).toBe(FULL_FIELDS);
  });

  test("pós-paga converte balance de centavos para reais", async () => {
    stub = installMetaFetchStub(() => ({
      body: { name: "Loja", currency: "BRL", account_status: 1, is_prepay_account: false, balance: "32000" },
    }));
    const read = await readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() });
    expect(read.isPrepaid).toBe(false);
    expect(read.money).toEqual({ kind: "owed", amountMajor: 320 });
  });

  test("balance zero é fatura de zero", async () => {
    stub = installMetaFetchStub(() => ({
      body: { name: "Loja", currency: "BRL", account_status: 1, is_prepay_account: false, balance: "0" },
    }));
    const read = await readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() });
    expect(read.money).toEqual({ kind: "owed", amountMajor: 0 });
  });

  for (const code of [10, 100, 200, 294]) {
    test(`recusa de permissão ${code} degrada para leitura só de identidade → blocked`, async () => {
      stub = installMetaFetchStub((req) => {
        if (req.params.get("fields") === FULL_FIELDS) {
          return { status: 400, body: graphErrorBody({ code, message: "Permissions error" }) };
        }
        return { body: { name: "Loja", currency: "BRL", account_status: 3 } };
      });
      const read = await readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() });
      expect(read).toMatchObject({
        name: "Loja",
        currency: "BRL",
        isPrepaid: null,
        money: { kind: "blocked" },
        accountStatus: 3,
        accountStatusLabel: "Não quitada",
      });
      expect(stub.calls.map((c) => c.params.get("fields"))).toEqual([FULL_FIELDS, IDENTITY_FIELDS]);
    });
  }

  test("token inválido (190) sobe sem segunda leitura", async () => {
    stub = installMetaFetchStub(() => ({
      status: 400,
      body: graphErrorBody({ code: 190, message: "Error validating access token" }),
    }));
    await expect(readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() })).rejects.toThrow();
    expect(stub.calls).toHaveLength(1);
  });

  test("rate limit sobe sem leitura só de identidade", async () => {
    stub = installMetaFetchStub(() => ({
      status: 400,
      body: graphErrorBody({ code: 17, message: "User request limit reached" }),
      headers: rateLimitHeaders(10),
    }));
    await expect(readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() })).rejects.toThrow();
    expect(stub.calls.every((c) => c.params.get("fields") === FULL_FIELDS)).toBe(true);
  });

  test("se a leitura só de identidade também falhar, o erro dela sobe", async () => {
    stub = installMetaFetchStub((req) => ({
      status: 400,
      body: graphErrorBody({
        code: 100,
        errorSubcode: 33,
        message: req.params.get("fields") === FULL_FIELDS ? "primeira" : "segunda",
      }),
    }));
    await expect(readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() })).rejects.toThrow("segunda");
    expect(stub.calls).toHaveLength(2);
  });

  test("pré-paga sem display_string é bloqueio", async () => {
    stub = installMetaFetchStub(() => ({
      body: { name: "Loja", currency: "BRL", account_status: 1, is_prepay_account: true, balance: "245" },
    }));
    const read = await readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() });
    expect(read.isPrepaid).toBe(true);
    expect(read.money).toEqual({ kind: "blocked" });
  });

  test("display_string em branco é bloqueio", async () => {
    stub = installMetaFetchStub(() => ({
      body: {
        name: "Loja",
        currency: "BRL",
        account_status: 1,
        is_prepay_account: true,
        funding_source_details: { display_string: "   " },
      },
    }));
    const read = await readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() });
    expect(read.money).toEqual({ kind: "blocked" });
  });

  test("pós-paga sem balance não tem valor para mostrar", async () => {
    stub = installMetaFetchStub(() => ({
      body: { name: "Loja", currency: "BRL", account_status: 9, is_prepay_account: false },
    }));
    const read = await readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() });
    expect(read.money).toEqual({ kind: "none" });
    expect(read.accountStatusLabel).toBe("Em período de carência");
  });

  test("Meta omite is_prepay_account e balance em silêncio → blocked, sem status", async () => {
    stub = installMetaFetchStub(() => ({ body: { id: "act_123" } }));
    const read = await readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() });
    expect(read).toMatchObject({
      name: null,
      currency: null,
      isPrepaid: null,
      money: { kind: "blocked" },
      accountStatus: null,
      accountStatusLabel: null,
    });
  });

  test("act_ e dígitos compartilham o cache", async () => {
    stub = installMetaFetchStub(() => ({
      body: { name: "Loja", currency: "BRL", account_status: 1, is_prepay_account: false, balance: "100" },
    }));
    const token = nextToken();
    const a = await readAdAccountMoney({ adAccountId: "act_123", accessToken: token });
    const b = await readAdAccountMoney({ adAccountId: "123", accessToken: token });
    expect(a.adAccountId).toBe("123");
    expect(b).toEqual(a);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].path).toBe("act_123");
  });

  test("fresh fura o cache e traz fetchedAt novo", async () => {
    let balance = 100;
    stub = installMetaFetchStub(() => ({
      body: { name: "Loja", currency: "BRL", account_status: 1, is_prepay_account: false, balance: String(balance) },
    }));
    const token = nextToken();
    const first = await readAdAccountMoney({ adAccountId: "123", accessToken: token });
    balance = 500;
    const cached = await readAdAccountMoney({ adAccountId: "123", accessToken: token });
    expect(cached.fetchedAt).toBe(first.fetchedAt);
    expect(cached.money).toEqual({ kind: "owed", amountMajor: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const fresh = await readAdAccountMoney({ adAccountId: "123", accessToken: token, fresh: true });
    expect(fresh.money).toEqual({ kind: "owed", amountMajor: 5 });
    expect(fresh.fetchedAt > first.fetchedAt).toBe(true);
    expect(stub.calls).toHaveLength(2);
  });

  test("fresh sob rate limit mantém o fetchedAt antigo", async () => {
    let throttled = false;
    stub = installMetaFetchStub(() =>
      throttled
        ? { status: 400, body: graphErrorBody({ code: 17 }), headers: rateLimitHeaders(10) }
        : { body: { name: "Loja", currency: "BRL", account_status: 1, is_prepay_account: false, balance: "100" } },
    );
    const token = nextToken();
    const first = await readAdAccountMoney({ adAccountId: "123", accessToken: token });
    throttled = true;
    const again = await readAdAccountMoney({ adAccountId: "123", accessToken: token, fresh: true });
    expect(again).toEqual(first);
  });
});
```

Run: `bun test lib/meta-business/ad-account-money-read.test.ts`
Expected: FAIL — módulo `./ad-account-money-read` não existe.

- [ ] **Step 5: Implementar o leitor**

Crie `lib/meta-business/ad-account-money-read.ts`:

```ts
/**
 * Saldo (pré-paga) ou fatura em aberto (pós-paga) + status de UMA conta de
 * anúncios, lido com o token do cliente para o card "Saldo / fatura na Meta"
 * do backoffice. A regra de dinheiro é a do app do cliente — vem das funções
 * espelhadas de `marketing/ad-account-money.ts`, nunca reescrita aqui.
 *
 * Não é espelhado pelo `sync:meta`: o app lê o dinheiro na listagem de contas
 * (`/me/adaccounts` / `assigned_ad_accounts`); o backoffice lê a conta escolhida.
 */
import type {
  AdAccountMoneyRead,
  AdAccountMoneyState,
} from "@/lib/backoffice/ad-account-money-types";
import { withActPrefix } from "@/lib/meta-business/account-match";
import { GraphApiError } from "@/lib/meta-business/error";
import { getAccountStatusLabel } from "@/lib/meta-business/insights/account";
import { callMeta } from "@/lib/meta-business/insights/client";
import {
  isAdAccountMoneyBlockedByPermission,
  resolveAdAccountMoney,
} from "@/lib/meta-business/marketing/ad-account-money";
import { cachedMetaRead, tokenCacheId } from "@/lib/meta-business/read-cache";

/** Mesmo frescor do app do cliente (read-cache de 5 min da listagem de contas). */
const AD_ACCOUNT_MONEY_CACHE_TTL_MS = 5 * 60 * 1000;

const IDENTITY_FIELDS = "name,currency,account_status";
/**
 * A Meta gateia por tarefa na conta: `funding_source_details` exige MANAGE e
 * `is_prepay_account` exige MANAGE ou ADVERTISE; `balance` não exige nenhuma.
 */
const MONEY_FIELDS = "balance,is_prepay_account,funding_source_details{display_string}";

type RawAdAccount = {
  name?: string;
  currency?: string;
  account_status?: number;
  balance?: string | number;
  is_prepay_account?: boolean;
  funding_source_details?: { display_string?: string };
};

/**
 * Recusa por permissão ou por campo (10, 100, 200–299): a leitura só de
 * identidade ainda pode passar. Token inválido (190/102), rate limit e erros
 * transitórios NÃO entram — degradar ali esconderia o problema real atrás de um
 * "Saldo indisponível".
 */
export function isMoneyFieldRejection(error: unknown): boolean {
  if (!(error instanceof GraphApiError)) return false;
  const code = error.errorReturn.data?.code;
  if (typeof code !== "number") return false;
  return code === 10 || code === 100 || (code >= 200 && code <= 299);
}

function fetchAdAccount(
  adAccountId: string,
  accessToken: string,
  fields: string,
): Promise<RawAdAccount> {
  return callMeta<RawAdAccount>({
    domain: "FACEBOOK",
    method: "GET",
    path: withActPrefix(adAccountId),
    params: `fields=${fields}`,
    accessToken,
  });
}

function resolveMoneyState(
  raw: RawAdAccount,
  moneyFieldsRejected: boolean,
): AdAccountMoneyState {
  if (moneyFieldsRejected) return { kind: "blocked" };
  const money = resolveAdAccountMoney(raw);
  if (money) return money;
  if (isAdAccountMoneyBlockedByPermission(raw)) return { kind: "blocked" };
  return { kind: "none" };
}

async function readAdAccountMoneyUncached(
  adAccountId: string,
  accessToken: string,
): Promise<AdAccountMoneyRead> {
  let raw: RawAdAccount;
  let moneyFieldsRejected = false;
  try {
    raw = await fetchAdAccount(adAccountId, accessToken, `${IDENTITY_FIELDS},${MONEY_FIELDS}`);
  } catch (error) {
    if (!isMoneyFieldRejection(error)) throw error;
    console.warn("backoffice.adAccountMoney.moneyFieldsRejected", {
      adAccountId,
      code: (error as GraphApiError).errorReturn.data?.code,
    });
    raw = await fetchAdAccount(adAccountId, accessToken, IDENTITY_FIELDS);
    moneyFieldsRejected = true;
  }

  const accountStatus = typeof raw.account_status === "number" ? raw.account_status : null;
  return {
    adAccountId,
    name: raw.name ?? null,
    currency: raw.currency ?? null,
    isPrepaid:
      !moneyFieldsRejected && typeof raw.is_prepay_account === "boolean"
        ? raw.is_prepay_account
        : null,
    money: resolveMoneyState(raw, moneyFieldsRejected),
    accountStatus,
    accountStatusLabel: accountStatus === null ? null : getAccountStatusLabel(accountStatus),
    fetchedAt: new Date().toISOString(),
  };
}

/** Lê o dinheiro e o status da conta; `fresh` ignora a entrada fresca do cache. */
export async function readAdAccountMoney(args: {
  adAccountId: string;
  accessToken: string;
  fresh?: boolean;
}): Promise<AdAccountMoneyRead> {
  const digits = args.adAccountId.replace(/^act_/, "");
  return cachedMetaRead({
    key: `acctmoney:${tokenCacheId(args.accessToken)}:${digits}`,
    ttlMs: AD_ACCOUNT_MONEY_CACHE_TTL_MS,
    forceRefresh: args.fresh === true,
    fetcher: () => readAdAccountMoneyUncached(digits, args.accessToken),
  });
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `bun test lib/meta-business/ad-account-money-read.test.ts lib/meta-business/insights/account-status-label.test.ts lib/meta-business/read-cache.test.ts`
Expected: PASS em todos. Se o teste de rate limit demorar ~1,5 s ou mostrar duas chamadas, confira que `rateLimitHeaders(10)` está no stub (com espera > 5 s o `callMeta` não repete).

- [ ] **Step 7: Commit**

```bash
git add lib/backoffice/ad-account-money-types.ts lib/meta-business/insights/account.ts lib/meta-business/insights/account-status-label.test.ts lib/meta-business/ad-account-money-read.ts lib/meta-business/ad-account-money-read.test.ts
git commit -m "feat(meta): leitor de saldo/fatura e status da conta de anúncios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Handler e rota `GET /api/users/[id]/ad-accounts/[accountId]/money`

**Files:**
- Create: `lib/meta-business/ad-account-money-handler.ts`
- Create: `lib/meta-business/ad-account-money-handler.test.ts`
- Create: `app/api/users/[id]/ad-accounts/[accountId]/money/route.ts`

**Interfaces:**
- Consumes: tipos de `@/lib/backoffice/ad-account-money-types` e `readAdAccountMoney` (Task 2); `GetAccessTokenResult` de `@/lib/meta-business/get-user-access-token`; `GraphApiError`, `graphErrorToClientError`, `findMappedError` de `@/lib/meta-business/error`; `ReconnectInfo`/`buildReconnectInfo` de `@/lib/meta-business/reconnect-link`; `requireMarketingUserAccessResponse` de `@/lib/auth/rbac`.
- Produces: `handleAdAccountMoney(request: Request, params: { userId: string; accountId: string }, deps: AdAccountMoneyHandlerDeps): Promise<Response>`; `AdAccountMoneyHandlerDeps`; a rota HTTP usada pela Task 5.

- [ ] **Step 1: Testes que falham**

Crie `lib/meta-business/ad-account-money-handler.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import type { AdAccountMoneyRead } from "@/lib/backoffice/ad-account-money-types";
import type { SafeMetaConnection } from "./connection-record";
import { findMappedError, GraphApiError } from "./error";
import type { GetAccessTokenResult } from "./get-user-access-token";
import {
  handleAdAccountMoney,
  type AdAccountMoneyHandlerDeps,
} from "./ad-account-money-handler";

const read: AdAccountMoneyRead = {
  adAccountId: "123",
  name: "Loja Centro",
  currency: "BRL",
  isPrepaid: true,
  money: { kind: "available", display: "R$ 15,63" },
  accountStatus: 1,
  accountStatusLabel: "Ativa",
  fetchedAt: "2026-09-30T17:32:00.000Z",
};

const reconnect = { url: "https://app.test/app/marketing", instructions: "Reconecte." };

function tokenOk(tokenKind: "bisu" | "user" = "bisu"): GetAccessTokenResult {
  return {
    success: true,
    accessToken: "tok",
    userId: "user-1",
    connection: { tokenKind } as unknown as SafeMetaConnection,
  };
}

function graphError(code: number, statusCode: number) {
  return new GraphApiError({
    statusCode,
    reason: findMappedError(code),
    data: { message: `erro ${code}`, type: "OAuthException", code },
  });
}

function setup(overrides: Partial<AdAccountMoneyHandlerDeps> = {}) {
  const reads: Array<{ adAccountId: string; accessToken: string; fresh: boolean }> = [];
  const tokenCalls: string[] = [];
  const deps: AdAccountMoneyHandlerDeps = {
    authorize: async () => ({ ok: true }),
    getAccessToken: async (userId) => {
      tokenCalls.push(userId);
      return tokenOk();
    },
    readMoney: async (args) => {
      reads.push(args);
      return read;
    },
    reconnectInfo: () => reconnect,
    ...overrides,
  };
  return { deps, reads, tokenCalls };
}

const req = (query = "") =>
  new Request(`http://localhost/api/users/user-1/ad-accounts/act_123/money${query}`);

describe("handleAdAccountMoney", () => {
  test("sucesso devolve a leitura + connectionKind, com a conta sem act_", async () => {
    const { deps, reads } = setup();
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "act_123" }, deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...read, connectionKind: "bisu" });
    expect(reads).toEqual([{ adAccountId: "123", accessToken: "tok", fresh: false }]);
  });

  test("connectionKind acompanha o token de usuário", async () => {
    const { deps } = setup({ getAccessToken: async () => tokenOk("user") });
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "123" }, deps);
    expect((await res.json()).connectionKind).toBe("user");
  });

  test("?fresh=1 chega ao leitor como fresh: true", async () => {
    const { deps, reads } = setup();
    await handleAdAccountMoney(req("?fresh=1"), { userId: "user-1", accountId: "123" }, deps);
    expect(reads[0].fresh).toBe(true);
  });

  test("autorização negada volta como veio, sem token nem Meta", async () => {
    const { deps, reads, tokenCalls } = setup({
      authorize: async () => ({ ok: false, response: Response.json({ denied: true }, { status: 403 }) }),
    });
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "123" }, deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ denied: true });
    expect(tokenCalls).toEqual([]);
    expect(reads).toEqual([]);
  });

  for (const accountId of ["abc", "act_12a", "", "act_", "123 ", "../123"]) {
    test(`id de conta inválido ${JSON.stringify(accountId)} → 400 sem buscar token`, async () => {
      const { deps, tokenCalls } = setup();
      const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId }, deps);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "invalid_account_id",
        message: "Conta de anúncios inválida.",
      });
      expect(tokenCalls).toEqual([]);
    });
  }

  test("sem conexão Meta → 404 no formato do /ad-accounts, sem reconnect", async () => {
    const { deps, reads } = setup({
      getAccessToken: async () => ({
        success: false,
        error: {
          error: "No connected account",
          message: "User does not have a connected Meta Business Account",
          solution: "User needs to connect their Facebook account first",
          statusCode: 404,
        },
      }),
    });
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "123" }, deps);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "No connected account",
      message: "User does not have a connected Meta Business Account",
      solution: "User needs to connect their Facebook account first",
    });
    expect(body.reconnect).toBeUndefined();
    expect(reads).toEqual([]);
  });

  test("conexão que precisa reconectar → 409 com reconnect", async () => {
    const { deps } = setup({
      getAccessToken: async () => ({
        success: false,
        error: { error: "Needs reconnect", message: "Reconecte", statusCode: 409, needsReconnect: true },
      }),
    });
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "123" }, deps);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ needsReconnect: true, reconnect });
  });

  test("erro 190 da Graph → 409 needsReconnect com reconnect", async () => {
    const { deps } = setup({
      readMoney: async () => {
        throw graphError(190, 400);
      },
    });
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "123" }, deps);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 190, needsReconnect: true, reconnect });
  });

  test("outro erro da Graph → status dele, sem reconnect", async () => {
    const { deps } = setup({
      readMoney: async () => {
        throw graphError(200, 403);
      },
    });
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "123" }, deps);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ code: 200, needsReconnect: false });
    expect(typeof body.message).toBe("string");
    expect(body.reconnect).toBeUndefined();
  });

  test("erro inesperado → 500 genérico, sem vazar a mensagem interna", async () => {
    const { deps } = setup({
      readMoney: async () => {
        throw new Error("connection refused 10.0.0.1");
      },
    });
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "123" }, deps);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
  });
});
```

Run: `bun test lib/meta-business/ad-account-money-handler.test.ts`
Expected: FAIL — módulo `./ad-account-money-handler` não existe.

- [ ] **Step 2: Implementar o handler**

Crie `lib/meta-business/ad-account-money-handler.ts`:

```ts
import type {
  AdAccountMoneyErrorResponse,
  AdAccountMoneyRead,
  AdAccountMoneyResponse,
} from "@/lib/backoffice/ad-account-money-types";
import { GraphApiError, graphErrorToClientError } from "@/lib/meta-business/error";
import type { GetAccessTokenResult } from "@/lib/meta-business/get-user-access-token";
import type { ReconnectInfo } from "@/lib/meta-business/reconnect-link";

type AuthzOutcome = { ok: true } | { ok: false; response: Response };

/**
 * Tudo que o handler toca fora de si, injetado para testar sem `mock.module`
 * (global e vazado entre arquivos no bun) — mesmo padrão de `create-pixel-handler`.
 */
export type AdAccountMoneyHandlerDeps = {
  authorize: (userId: string) => Promise<AuthzOutcome>;
  getAccessToken: (userId: string) => Promise<GetAccessTokenResult>;
  readMoney: (args: {
    adAccountId: string;
    accessToken: string;
    fresh: boolean;
  }) => Promise<AdAccountMoneyRead>;
  reconnectInfo: () => ReconnectInfo;
};

const ACCOUNT_ID_PATTERN = /^(act_)?\d+$/;

function json(body: AdAccountMoneyResponse | AdAccountMoneyErrorResponse, status: number) {
  return Response.json(body, { status });
}

/**
 * `GET /api/users/{id}/ad-accounts/{accountId}/money[?fresh=1]` — saldo
 * (pré-paga) ou fatura em aberto (pós-paga) + status da conta, lidos com o token
 * do cliente. Mesmo guard e mesmo formato de erro do `/api/users/{id}/ad-accounts`.
 * Leitura: sem auditoria (o backoffice só audita mutações).
 */
export async function handleAdAccountMoney(
  request: Request,
  params: { userId: string; accountId: string },
  deps: AdAccountMoneyHandlerDeps,
): Promise<Response> {
  const authz = await deps.authorize(params.userId);
  if (!authz.ok) return authz.response;

  if (!ACCOUNT_ID_PATTERN.test(params.accountId)) {
    return json({ error: "invalid_account_id", message: "Conta de anúncios inválida." }, 400);
  }

  const tokenResult = await deps.getAccessToken(params.userId);
  if (!tokenResult.success) {
    const { error } = tokenResult;
    return json(
      {
        error: error.error,
        message: error.message,
        solution: error.solution,
        needsReconnect: error.needsReconnect,
        ...(error.needsReconnect ? { reconnect: deps.reconnectInfo() } : {}),
      },
      error.statusCode,
    );
  }

  const fresh = new URL(request.url).searchParams.get("fresh") === "1";

  try {
    const read = await deps.readMoney({
      adAccountId: params.accountId.replace(/^act_/, ""),
      accessToken: tokenResult.accessToken,
      fresh,
    });
    return json({ ...read, connectionKind: tokenResult.connection.tokenKind }, 200);
  } catch (error) {
    if (error instanceof GraphApiError) {
      const errorReturn = error.errorReturn;
      const code = errorReturn.data?.code;
      const errorSubcode = errorReturn.data?.errorSubcode;
      // 190 (inclui 460/463): o token guardado morreu — só reconectando.
      const needsReconnect = code === 190;
      console.error("backoffice.adAccountMoney.graphError", { code, errorSubcode, needsReconnect });
      return json(
        {
          ...graphErrorToClientError(errorReturn),
          code,
          errorSubcode,
          needsReconnect,
          ...(needsReconnect ? { reconnect: deps.reconnectInfo() } : {}),
        },
        needsReconnect ? 409 : errorReturn.statusCode,
      );
    }

    console.error("backoffice.adAccountMoney.unexpected", error);
    return json(
      {
        error: "Internal server error",
        message: "Não foi possível consultar a Meta agora.",
        solution: "Tente de novo em instantes.",
      },
      500,
    );
  }
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `bun test lib/meta-business/ad-account-money-handler.test.ts`
Expected: PASS (todos, incluindo os 6 ids inválidos).

- [ ] **Step 4: Criar a rota**

Crie `app/api/users/[id]/ad-accounts/[accountId]/money/route.ts`:

```ts
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { handleAdAccountMoney } from "@/lib/meta-business/ad-account-money-handler";
import { readAdAccountMoney } from "@/lib/meta-business/ad-account-money-read";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { buildReconnectInfo } from "@/lib/meta-business/reconnect-link";

/**
 * GET /api/users/[id]/ad-accounts/[accountId]/money[?fresh=1]
 *
 * Saldo (pré-paga) ou fatura em aberto (pós-paga) + status da conta de anúncios,
 * com o token do cliente. `?fresh=1` ignora o cache de 5 minutos (botão "Atualizar").
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; accountId: string }> },
): Promise<Response> {
  const { id: userId, accountId } = await params;
  return handleAdAccountMoney(
    request,
    { userId, accountId },
    {
      authorize: (id) => requireMarketingUserAccessResponse(id, "marketing:read"),
      getAccessToken: getUserAccessTokenByUserId,
      readMoney: readAdAccountMoney,
      reconnectInfo: buildReconnectInfo,
    },
  );
}
```

- [ ] **Step 5: Checar tipos do que foi criado**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ad-account-money|read-cache|insights/account" ; echo "exit-grep=$?"`
Expected: nenhuma linha de erro para esses arquivos (`exit-grep=1`). Erros pré-existentes em outros arquivos, se houver, não são desta tarefa.

- [ ] **Step 6: Commit**

```bash
git add lib/meta-business/ad-account-money-handler.ts lib/meta-business/ad-account-money-handler.test.ts "app/api/users/[id]/ad-accounts/[accountId]/money/route.ts"
git commit -m "feat(backoffice): rota de saldo/fatura da conta de anúncios do usuário

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Lógica de exibição `describeAdAccountMoney`

**Files:**
- Create: `lib/backoffice/describe-ad-account-money.ts`
- Create: `lib/backoffice/describe-ad-account-money.test.ts`

**Interfaces:**
- Consumes: `AdAccountMoneyResponse` de `./ad-account-money-types` (Task 2).
- Produces: `describeAdAccountMoney(response: AdAccountMoneyResponse): AdAccountMoneyView`; `AdAccountMoneyView`; `AdAccountMoneyTone = "neutral" | "warning" | "destructive" | "outline"`; `statusTone(status: number | null): AdAccountMoneyTone`; `formatOwedAmount(amountMajor: number, currency: string | null): string`; constantes `BLOCKED_REASON_BISU`, `BLOCKED_REASON_USER`, `NO_MONEY_TEXT`. Usado pela Task 5.

- [ ] **Step 1: Testes que falham**

Crie `lib/backoffice/describe-ad-account-money.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import type { AdAccountMoneyResponse } from "./ad-account-money-types";
import {
  BLOCKED_REASON_BISU,
  BLOCKED_REASON_USER,
  describeAdAccountMoney,
  formatOwedAmount,
  NO_MONEY_TEXT,
  statusTone,
} from "./describe-ad-account-money";

/** Intl usa espaço não separável entre símbolo e número; normalize para comparar. */
const plain = (value: string) => value.replace(/\s/g, " ");

function response(patch: Partial<AdAccountMoneyResponse>): AdAccountMoneyResponse {
  return {
    adAccountId: "123",
    name: "Loja Centro",
    currency: "BRL",
    isPrepaid: true,
    money: { kind: "available", display: "R$ 15,63" },
    accountStatus: 1,
    accountStatusLabel: "Ativa",
    fetchedAt: "2026-09-30T17:32:00.000Z",
    connectionKind: "bisu",
    ...patch,
  };
}

describe("describeAdAccountMoney", () => {
  test("pré-paga: rótulo Saldo disponível + texto da Meta intacto", () => {
    expect(describeAdAccountMoney(response({}))).toEqual({
      typeLabel: "Pré-paga",
      status: { label: "Ativa", tone: "neutral" },
      main: { kind: "amount", label: "Saldo disponível", value: "R$ 15,63" },
    });
  });

  test("texto da Meta que já diz 'saldo' não repete o rótulo", () => {
    const view = describeAdAccountMoney(
      response({ money: { kind: "available", display: "Saldo disponível (R$ 15,63 BRL)" } }),
    );
    expect(view.main).toEqual({ kind: "amount", label: null, value: "Saldo disponível (R$ 15,63 BRL)" });
    const upper = describeAdAccountMoney(
      response({ money: { kind: "available", display: "SALDO: R$ 1,00" } }),
    );
    expect(upper.main).toMatchObject({ label: null });
  });

  test("pós-paga: Fatura em aberto na moeda da conta", () => {
    const view = describeAdAccountMoney(
      response({ isPrepaid: false, money: { kind: "owed", amountMajor: 320 } }),
    );
    expect(view.typeLabel).toBe("Pós-paga");
    expect(view.main).toMatchObject({ kind: "amount", label: "Fatura em aberto" });
    expect(plain((view.main as { value: string }).value)).toBe("R$ 320,00");
  });

  test("bloqueado BISU explica o acesso de administrador", () => {
    const view = describeAdAccountMoney(
      response({ isPrepaid: null, money: { kind: "blocked" }, connectionKind: "bisu" }),
    );
    expect(view.typeLabel).toBeNull();
    expect(view.main).toEqual({ kind: "blocked", title: "Saldo indisponível", reason: BLOCKED_REASON_BISU });
    expect(BLOCKED_REASON_BISU).toBe(
      "A Meta só mostra o saldo para integrações com acesso de administrador. Peça ao cliente para conceder controle total (Administrador) desta conta de anúncios à Automatize no Gerenciador de Negócios e reconectar.",
    );
  });

  test("bloqueado token de usuário explica que quem conectou não é administrador", () => {
    const view = describeAdAccountMoney(
      response({ isPrepaid: null, money: { kind: "blocked" }, connectionKind: "user" }),
    );
    expect(view.main).toEqual({ kind: "blocked", title: "Saldo indisponível", reason: BLOCKED_REASON_USER });
    expect(BLOCKED_REASON_USER).toBe(
      "A Meta não devolveu o saldo para quem conectou esta conta — provavelmente não é administrador dela.",
    );
  });

  test("sem valor mostra o texto de ausência", () => {
    const view = describeAdAccountMoney(response({ isPrepaid: false, money: { kind: "none" } }));
    expect(view.main).toEqual({ kind: "empty", text: NO_MONEY_TEXT });
    expect(NO_MONEY_TEXT).toBe("A Meta não informou saldo nem fatura para esta conta.");
  });

  test("sem rótulo de status não há selo", () => {
    const view = describeAdAccountMoney(response({ accountStatus: null, accountStatusLabel: null }));
    expect(view.status).toBeNull();
  });

  test("selo usa o rótulo e o tom do status", () => {
    const view = describeAdAccountMoney(response({ accountStatus: 3, accountStatusLabel: "Não quitada" }));
    expect(view.status).toEqual({ label: "Não quitada", tone: "warning" });
  });
});

describe("statusTone", () => {
  test("Ativa é neutro", () => {
    expect(statusTone(1)).toBe("neutral");
  });
  test("dinheiro travando a veiculação é âmbar", () => {
    for (const s of [3, 8, 9]) expect(statusTone(s)).toBe("warning");
  });
  test("conta parada ou fechada é destrutivo", () => {
    for (const s of [2, 7, 100, 101]) expect(statusTone(s)).toBe("destructive");
  });
  test("desconhecido ou ausente é contorno", () => {
    expect(statusTone(null)).toBe("outline");
    expect(statusTone(0)).toBe("outline");
    expect(statusTone(201)).toBe("outline");
  });
});

describe("formatOwedAmount", () => {
  test("fatura zero formata R$ 0,00", () => {
    expect(plain(formatOwedAmount(0, "BRL"))).toBe("R$ 0,00");
  });
  test("moeda da conta é respeitada", () => {
    expect(plain(formatOwedAmount(1234.56, "USD"))).toBe("US$ 1.234,56");
  });
  test("moeda ausente cai em BRL", () => {
    expect(plain(formatOwedAmount(10, null))).toBe("R$ 10,00");
  });
  test("moeda inválida cai em BRL", () => {
    expect(plain(formatOwedAmount(10, "invalid"))).toBe("R$ 10,00");
  });
});
```

Run: `bun test lib/backoffice/describe-ad-account-money.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 2: Implementar**

Crie `lib/backoffice/describe-ad-account-money.ts`:

```ts
import type { AdAccountMoneyResponse } from "./ad-account-money-types";

export type AdAccountMoneyTone = "neutral" | "warning" | "destructive" | "outline";

/** O que o card "Saldo / fatura na Meta" desenha — decidido aqui, sem React. */
export type AdAccountMoneyView = {
  typeLabel: "Pré-paga" | "Pós-paga" | null;
  status: { label: string; tone: AdAccountMoneyTone } | null;
  main:
    | { kind: "amount"; label: string | null; value: string }
    | { kind: "blocked"; title: "Saldo indisponível"; reason: string }
    | { kind: "empty"; text: string };
};

export const BLOCKED_REASON_BISU =
  "A Meta só mostra o saldo para integrações com acesso de administrador. Peça ao cliente para conceder controle total (Administrador) desta conta de anúncios à Automatize no Gerenciador de Negócios e reconectar.";
export const BLOCKED_REASON_USER =
  "A Meta não devolveu o saldo para quem conectou esta conta — provavelmente não é administrador dela.";
export const NO_MONEY_TEXT = "A Meta não informou saldo nem fatura para esta conta.";

/** Não quitada, Aguardando pagamento, Em período de carência: o dinheiro trava a veiculação. */
const WARNING_STATUSES = new Set([3, 8, 9]);
/** Desativada, Em revisão de risco, Fechamento pendente, Fechada. */
const DESTRUCTIVE_STATUSES = new Set([2, 7, 100, 101]);

export function statusTone(status: number | null): AdAccountMoneyTone {
  if (status === null) return "outline";
  if (status === 1) return "neutral";
  if (WARNING_STATUSES.has(status)) return "warning";
  if (DESTRUCTIVE_STATUSES.has(status)) return "destructive";
  return "outline";
}

/** Fatura em aberto na moeda da conta; moeda ausente ou inválida → BRL. */
export function formatOwedAmount(amountMajor: number, currency: string | null): string {
  const format = (code: string) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(amountMajor);
  if (currency) {
    try {
      return format(currency);
    } catch {
      // Código malformado: o Intl recusa — cai no BRL abaixo.
    }
  }
  return format("BRL");
}

function describeMain(response: AdAccountMoneyResponse): AdAccountMoneyView["main"] {
  const { money } = response;
  switch (money.kind) {
    case "available":
      // O texto é da Meta e vai sem alteração; às vezes ele já traz "Saldo disponível (…)".
      return {
        kind: "amount",
        label: /saldo/i.test(money.display) ? null : "Saldo disponível",
        value: money.display,
      };
    case "owed":
      return {
        kind: "amount",
        label: "Fatura em aberto",
        value: formatOwedAmount(money.amountMajor, response.currency),
      };
    case "blocked":
      return {
        kind: "blocked",
        title: "Saldo indisponível",
        reason: response.connectionKind === "bisu" ? BLOCKED_REASON_BISU : BLOCKED_REASON_USER,
      };
    case "none":
      return { kind: "empty", text: NO_MONEY_TEXT };
  }
}

export function describeAdAccountMoney(response: AdAccountMoneyResponse): AdAccountMoneyView {
  return {
    typeLabel: response.isPrepaid === null ? null : response.isPrepaid ? "Pré-paga" : "Pós-paga",
    status:
      response.accountStatusLabel === null
        ? null
        : { label: response.accountStatusLabel, tone: statusTone(response.accountStatus) },
    main: describeMain(response),
  };
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `bun test lib/backoffice/describe-ad-account-money.test.ts`
Expected: PASS. Se "US$ 1.234,56" divergir por versão de ICU, confira com `bun -e 'console.log(new Intl.NumberFormat("pt-BR",{style:"currency",currency:"USD"}).format(1234.56))'` e ajuste só a expectativa do teste para a saída real do runtime (a regra é "usa a moeda da conta").

- [ ] **Step 4: Commit**

```bash
git add lib/backoffice/describe-ad-account-money.ts lib/backoffice/describe-ad-account-money.test.ts
git commit -m "feat(backoffice): regra de exibição do saldo/fatura da conta de anúncios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Card "Saldo / fatura na Meta" no MarketingWorkspace + verificação no navegador

**Files:**
- Create: `app/(admin)/marketing/hooks/use-ad-account-money.ts`
- Create: `app/(admin)/marketing/hooks/use-ad-account-money.test.ts`
- Create: `app/(admin)/marketing/components/ad-account-money-panel.tsx`
- Modify: `app/(admin)/marketing/components/marketing-workspace.tsx` (imports ~linhas 32-45; bloco "Conta de anúncios" ~linhas 466-512)
- Evidências (não versionadas): `.scratch/meta-ad-account-money/screenshots/*.png`, `.scratch/meta-ad-account-money/ui-verification.md`

**Interfaces:**
- Consumes: rota da Task 3; `AdAccountMoneyResponse`, `AdAccountMoneyErrorResponse` (Task 2); `describeAdAccountMoney`, `AdAccountMoneyTone` (Task 4); `formatTimeInSaoPaulo` de `@/lib/backoffice/datetime-format`; `Badge`, `Button`; `toast` de `sonner`.
- Produces: `adAccountMoneyQueryKey(userId, accountId)`, `fetchAdAccountMoney(userId, accountId, fresh, fetchImpl?)`, `refreshAdAccountMoney(queryClient, userId, accountId, fetchImpl?)`, `AdAccountMoneyRequestError`, `useAdAccountMoney(userId, accountId)`, `useRefreshAdAccountMoney(userId)`; componente `AdAccountMoneyPanel({ userId, accountId })`.

- [ ] **Step 1: Testes que falham para o hook**

Crie `app/(admin)/marketing/hooks/use-ad-account-money.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import type { AdAccountMoneyResponse } from "@/lib/backoffice/ad-account-money-types";
import {
  AdAccountMoneyRequestError,
  adAccountMoneyQueryKey,
  fetchAdAccountMoney,
  refreshAdAccountMoney,
} from "./use-ad-account-money";

const body: AdAccountMoneyResponse = {
  adAccountId: "1",
  name: "Conta 1",
  currency: "BRL",
  isPrepaid: false,
  money: { kind: "owed", amountMajor: 10 },
  accountStatus: 1,
  accountStatusLabel: "Ativa",
  fetchedAt: "2026-09-30T17:32:00.000Z",
  connectionKind: "user",
};

function fakeFetch(status: number, payload: unknown) {
  const urls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json(payload, { status });
  }) as typeof fetch;
  return { impl, urls };
}

describe("fetchAdAccountMoney", () => {
  test("monta a URL da rota e só pede fresh quando pedido", async () => {
    const f = fakeFetch(200, body);
    await fetchAdAccountMoney("user-1", "act_1", false, f.impl);
    await fetchAdAccountMoney("user-1", "act_1", true, f.impl);
    expect(f.urls).toEqual([
      "/api/users/user-1/ad-accounts/act_1/money",
      "/api/users/user-1/ad-accounts/act_1/money?fresh=1",
    ]);
  });

  test("erro HTTP vira AdAccountMoneyRequestError com o corpo da rota", async () => {
    const f = fakeFetch(403, { error: "Sem permissão", message: "Falta acesso", solution: "Conceda acesso" });
    const error = await fetchAdAccountMoney("user-1", "act_1", false, f.impl).catch((e) => e);
    expect(error).toBeInstanceOf(AdAccountMoneyRequestError);
    expect(error.status).toBe(403);
    expect(error.body).toMatchObject({ message: "Falta acesso", solution: "Conceda acesso" });
    expect(error.message).toBe("Falta acesso");
  });
});

describe("refreshAdAccountMoney", () => {
  test("grava o dado novo só na chave da conta atualizada", async () => {
    const queryClient = new QueryClient();
    const other = { ...body, adAccountId: "2", name: "Conta 2" };
    queryClient.setQueryData(adAccountMoneyQueryKey("user-1", "act_2"), other);
    const f = fakeFetch(200, body);

    // Simula: operador clica "Atualizar" na conta 1 e troca para a conta 2 antes da resposta.
    const data = await refreshAdAccountMoney(queryClient, "user-1", "act_1", f.impl);

    expect(data).toEqual(body);
    expect(queryClient.getQueryData(adAccountMoneyQueryKey("user-1", "act_1"))).toEqual(body);
    expect(queryClient.getQueryData(adAccountMoneyQueryKey("user-1", "act_2"))).toEqual(other);
    expect(f.urls).toEqual(["/api/users/user-1/ad-accounts/act_1/money?fresh=1"]);
  });
});
```

Run: `bun test "app/(admin)/marketing/hooks/use-ad-account-money.test.ts"`
Expected: FAIL — módulo não existe.

- [ ] **Step 2: Implementar o hook**

Crie `app/(admin)/marketing/hooks/use-ad-account-money.ts`:

```ts
"use client";

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AdAccountMoneyErrorResponse,
  AdAccountMoneyResponse,
} from "@/lib/backoffice/ad-account-money-types";

/** Mesmo frescor do cache do servidor: trocar de conta e voltar não relê a Meta. */
const AD_ACCOUNT_MONEY_STALE_MS = 5 * 60 * 1000;

export const adAccountMoneyQueryKey = (userId: string, accountId: string) =>
  ["ad-account-money", userId, accountId] as const;

export class AdAccountMoneyRequestError extends Error {
  constructor(
    readonly body: AdAccountMoneyErrorResponse | null,
    readonly status: number,
  ) {
    super(body?.message ?? "request_failed");
    this.name = "AdAccountMoneyRequestError";
  }
}

export async function fetchAdAccountMoney(
  userId: string,
  accountId: string,
  fresh: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<AdAccountMoneyResponse> {
  const url = `/api/users/${encodeURIComponent(userId)}/ad-accounts/${encodeURIComponent(accountId)}/money${fresh ? "?fresh=1" : ""}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as AdAccountMoneyErrorResponse | null;
    throw new AdAccountMoneyRequestError(body, response.status);
  }
  return (await response.json()) as AdAccountMoneyResponse;
}

/**
 * Leitura forçada ("Atualizar"). A conta vem como ARGUMENTO, não do render: se o
 * operador trocar de conta com a leitura em voo, o dado cai na conta atualizada.
 */
export async function refreshAdAccountMoney(
  queryClient: QueryClient,
  userId: string,
  accountId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AdAccountMoneyResponse> {
  const data = await fetchAdAccountMoney(userId, accountId, true, fetchImpl);
  queryClient.setQueryData(adAccountMoneyQueryKey(userId, accountId), data);
  return data;
}

export function useAdAccountMoney(userId: string, accountId: string) {
  return useQuery({
    queryKey: adAccountMoneyQueryKey(userId, accountId),
    queryFn: () => fetchAdAccountMoney(userId, accountId, false),
    enabled: Boolean(userId && accountId),
    staleTime: AD_ACCOUNT_MONEY_STALE_MS,
    // Cada tentativa é uma chamada à Meta; o operador tem "Tentar de novo".
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useRefreshAdAccountMoney(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => refreshAdAccountMoney(queryClient, userId, accountId),
  });
}
```

Run: `bun test "app/(admin)/marketing/hooks/use-ad-account-money.test.ts"`
Expected: PASS (3 testes).

- [ ] **Step 3: Implementar o card**

Crie `app/(admin)/marketing/components/ad-account-money-panel.tsx`:

```tsx
"use client";

import { useId } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdAccountMoneyResponse } from "@/lib/backoffice/ad-account-money-types";
import { formatTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";
import {
  describeAdAccountMoney,
  type AdAccountMoneyTone,
} from "@/lib/backoffice/describe-ad-account-money";
import { cn } from "@/lib/utils";
import {
  AdAccountMoneyRequestError,
  useAdAccountMoney,
  useRefreshAdAccountMoney,
} from "../hooks/use-ad-account-money";

const TONE_BADGE: Record<
  AdAccountMoneyTone,
  { variant: "secondary" | "destructive" | "outline"; className?: string }
> = {
  neutral: { variant: "secondary" },
  warning: {
    variant: "outline",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  destructive: { variant: "destructive" },
  outline: { variant: "outline" },
};

function describeError(error: unknown): { message: string; solution?: string } {
  if (error instanceof AdAccountMoneyRequestError && error.body?.message) {
    return { message: error.body.message, solution: error.body.solution };
  }
  return { message: "Verifique a conexão e tente de novo." };
}

function MoneyView({ data }: { data: AdAccountMoneyResponse }) {
  const view = describeAdAccountMoney(data);
  return (
    <div className="space-y-2">
      {(view.typeLabel || view.status) && (
        <div className="flex flex-wrap items-center gap-2">
          {view.typeLabel && (
            <span className="text-xs font-medium text-muted-foreground">{view.typeLabel}</span>
          )}
          {view.status && (
            <Badge
              variant={TONE_BADGE[view.status.tone].variant}
              className={TONE_BADGE[view.status.tone].className}
            >
              {view.status.label}
            </Badge>
          )}
        </div>
      )}

      {view.main.kind === "amount" && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {view.main.label && (
            <span className="text-sm text-muted-foreground">{view.main.label}</span>
          )}
          <span className="min-w-0 break-words text-lg font-semibold text-foreground">
            {view.main.value}
          </span>
        </div>
      )}

      {view.main.kind === "blocked" && (
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">{view.main.title}</p>
            <p className="break-words text-xs text-muted-foreground">{view.main.reason}</p>
          </div>
        </div>
      )}

      {view.main.kind === "empty" && (
        <p className="text-sm text-muted-foreground">{view.main.text}</p>
      )}
    </div>
  );
}

export function AdAccountMoneyPanel({
  userId,
  accountId,
}: {
  userId: string;
  accountId: string;
}) {
  const headingId = useId();
  const query = useAdAccountMoney(userId, accountId);
  const refresh = useRefreshAdAccountMoney(userId);
  const isRefreshingThisAccount = refresh.isPending && refresh.variables === accountId;
  const isReading = query.isFetching || isRefreshingThisAccount;

  function handleRefresh() {
    refresh.mutate(accountId, {
      onError: (error) => {
        toast.error("Não foi possível atualizar o saldo", {
          description: describeError(error).message,
        });
      },
    });
  }

  return (
    <section className="space-y-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-medium text-foreground">
        Saldo / fatura na Meta
      </h3>
      <div className="rounded-md border border-border bg-muted/30 p-4">
        {query.isPending ? (
          <p className="text-sm text-muted-foreground">Consultando a Meta…</p>
        ) : query.isError ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              Não foi possível consultar o saldo
            </p>
            <p className="break-words text-xs text-muted-foreground">
              {describeError(query.error).message}
            </p>
            {describeError(query.error).solution && (
              <p className="break-words text-xs text-muted-foreground">
                {describeError(query.error).solution}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={isReading}
            >
              Tentar de novo
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <MoneyView data={query.data} />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
              <span className="text-xs text-muted-foreground">
                Atualizado às {formatTimeInSaoPaulo(query.data.fetchedAt)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isReading}
              >
                <RefreshCw className={cn("h-4 w-4", isReading && "animate-spin")} aria-hidden />
                Atualizar
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Encaixar no MarketingWorkspace**

Em `app/(admin)/marketing/components/marketing-workspace.tsx`:

1. Nos imports locais (junto de `import { AdAccountSelector } from "./ad-account-selector";`), acrescente:

```tsx
import { AdAccountMoneyPanel } from "./ad-account-money-panel";
```

2. Logo DEPOIS do bloco `{metaAccount && ( <div className="space-y-2"> <h3 …>Conta de anúncios</h3> … </div> )}` (o último filho do `<div className="space-y-6">` dentro do `CardContent` de "Detalhes do usuário"), acrescente como irmão:

```tsx
              {metaAccount && selectedAccountId && !adAccountsError ? (
                <AdAccountMoneyPanel
                  userId={selectedUser.id}
                  accountId={selectedAccountId}
                />
              ) : null}
```

(`!adAccountsError` evita um segundo aviso de erro quando a lista de contas já falhou — o `MetaTokenIssue` acima cobre esse caso.)

- [ ] **Step 5: Tipos e testes da tarefa**

Run: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ad-account-money|marketing-workspace" ; echo "exit-grep=$?"`
Expected: `exit-grep=1` (nenhum erro nesses arquivos).

Run: `bun test "app/(admin)/marketing/hooks/use-ad-account-money.test.ts" lib/backoffice/describe-ad-account-money.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit do código**

```bash
git add "app/(admin)/marketing/hooks/use-ad-account-money.ts" "app/(admin)/marketing/hooks/use-ad-account-money.test.ts" "app/(admin)/marketing/components/ad-account-money-panel.tsx" "app/(admin)/marketing/components/marketing-workspace.tsx"
git commit -m "feat(backoffice): card de saldo/fatura da Meta na aba Marketing do usuário

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Subir o backoffice contra a staging**

Na worktree, em segundo plano (use a opção de background da ferramenta de shell; não bloqueie o terminal):

```bash
APP_ENV=staging bun scripts/with-env.ts next dev -p 3006 > .scratch/meta-ad-account-money/dev-server.log 2>&1
```

Espere ficar pronto (repita até dar 200 ou 307; no máximo ~2 min):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3006/login
```

Se o log mostrar erro de Turbopack (ex.: nome de chunk ilegal no Windows), pare o processo e suba com `APP_ENV=staging bun scripts/with-env.ts next dev --webpack -p 3006`. Confira no topo do log que o banco é o da staging (`wsbsnzgzqiehqnklzchm`), nunca o de produção (`hosjqwtfjjtmphchsuqf`); se for produção, PARE e registre no ledger.

- [ ] **Step 8: Sessão local do backoffice (só em localhost)**

Crie `.scratch/meta-ad-account-money/mint-session.ts`:

```ts
import { writeFileSync } from "node:fs";
import { createBackofficeMagicSessionToken } from "../../lib/auth/magic-session";

// educacaoleg@gmail.com está em ADMIN_EMAILS (lib/config.ts). O token assina com o
// segredo do ambiente carregado (staging) e só é usado no servidor local :3006.
writeFileSync(
  ".scratch/meta-ad-account-money/session-token.txt",
  createBackofficeMagicSessionToken("educacaoleg@gmail.com"),
);
console.log("token gravado em .scratch/meta-ad-account-money/session-token.txt");
```

Run: `APP_ENV=staging bun scripts/with-env.ts bun .scratch/meta-ad-account-money/mint-session.ts`
Expected: `token gravado em …`. **Nunca imprima o token** em saída de comando nem em relatório.

Consulte a sintaxe exata com `agent-browser cookies --help` e aplique o cookie só na origem local, por exemplo:

```bash
agent-browser open http://localhost:3006/login
agent-browser cookies set backoffice_magic_session "$(cat .scratch/meta-ad-account-money/session-token.txt)" --url http://localhost:3006
agent-browser open http://localhost:3006/marketing
agent-browser screenshot .scratch/meta-ad-account-money/screenshots/00-login-ok.png
```

Expected: a página `/marketing` abre sem redirecionar para `/login`. Se redirecionar, confira em `lib/auth/admin.ts`/`backoffice-users.ts` como a sessão mágica é aceita e registre o que foi preciso no ledger.

- [ ] **Step 9: Achar um usuário da staging com Meta conectada**

Opção A (UI): em `/marketing`, use o seletor de usuários e escolha um cliente com "Conectado" no status da conta de marketing do Facebook.

Opção B (SELECT somente leitura): confira em `lib/db/schema.ts` a tabela `metaBusinessAccount` (nomes de colunas `user_id`, `deleted_at`, `connection_status`, `token_kind`) e rode um script `.scratch/meta-ad-account-money/find-user.ts` que faça apenas:

```ts
import { sql } from "drizzle-orm";
import { db } from "../../lib/db";

const rows = await db.execute(sql`
  select user_id, token_kind, connection_status
  from meta_business_accounts
  where deleted_at is null and connection_status = 'active'
  order by updated_at desc
  limit 10
`);
console.log(rows);
process.exit(0);
```

Run: `APP_ENV=staging bun scripts/with-env.ts bun .scratch/meta-ad-account-money/find-user.ts` (ajuste os nomes de coluna se o schema diferir; somente `SELECT`).

- [ ] **Step 10: Screenshot do estado REAL**

```bash
agent-browser open "http://localhost:3006/users/<USER_ID>?tab=marketing"
```

Espere o card sair de "Consultando a Meta…" (use `agent-browser wait`/`snapshot` para achar o texto "Saldo / fatura na Meta" e o valor). Então:

```bash
agent-browser screenshot .scratch/meta-ad-account-money/screenshots/01-real-perfil.png
```

Clique em "Atualizar" (ache a referência com `agent-browser snapshot -i` ou `agent-browser find`), espere, e fotografe `02-real-apos-atualizar.png` (o horário do rodapé deve mudar ou se manter se a Meta limitou a taxa). Troque de conta no seletor, se o usuário tiver mais de uma, e fotografe `03-real-outra-conta.png`. Abra também `http://localhost:3006/marketing?userId=<USER_ID>` e fotografe `04-real-pagina-marketing.png` (R12).

Anote em `ui-verification.md` o tipo de conexão e o estado observado (sem token, sem dados pessoais além do e-mail do cliente mascarado, ex.: `ga***@gmail.com`).

- [ ] **Step 11: Screenshots dos estados simulados**

Para cada corpo abaixo: aplique o route, recarregue a aba Marketing do mesmo usuário, espere o card e fotografe. Remova o route antes do próximo (`agent-browser network unroute`).

```bash
agent-browser network route "**/ad-accounts/*/money*" --body '<CORPO>'
agent-browser reload
agent-browser screenshot .scratch/meta-ad-account-money/screenshots/<ARQUIVO>.png
agent-browser network unroute
```

| Arquivo | `<CORPO>` |
|---|---|
| `10-pre-paga.png` | `{"adAccountId":"123","name":"Loja Centro","currency":"BRL","isPrepaid":true,"money":{"kind":"available","display":"R$ 15,63"},"accountStatus":1,"accountStatusLabel":"Ativa","fetchedAt":"2026-09-30T17:32:00.000Z","connectionKind":"bisu"}` |
| `11-pre-paga-nao-quitada.png` | `{"adAccountId":"123","name":"Loja Centro","currency":"BRL","isPrepaid":true,"money":{"kind":"available","display":"R$ 0,00"},"accountStatus":3,"accountStatusLabel":"Não quitada","fetchedAt":"2026-09-30T17:32:00.000Z","connectionKind":"bisu"}` |
| `12-pos-paga.png` | `{"adAccountId":"123","name":"Loja Centro","currency":"BRL","isPrepaid":false,"money":{"kind":"owed","amountMajor":320},"accountStatus":1,"accountStatusLabel":"Ativa","fetchedAt":"2026-09-30T17:32:00.000Z","connectionKind":"user"}` |
| `13-bloqueado-bisu.png` | `{"adAccountId":"123","name":"Loja Centro","currency":"BRL","isPrepaid":null,"money":{"kind":"blocked"},"accountStatus":1,"accountStatusLabel":"Ativa","fetchedAt":"2026-09-30T17:32:00.000Z","connectionKind":"bisu"}` |
| `14-bloqueado-usuario.png` | `{"adAccountId":"123","name":"Loja Centro","currency":"BRL","isPrepaid":null,"money":{"kind":"blocked"},"accountStatus":1,"accountStatusLabel":"Ativa","fetchedAt":"2026-09-30T17:32:00.000Z","connectionKind":"user"}` |
| `15-sem-valor.png` | `{"adAccountId":"123","name":"Loja Centro","currency":"BRL","isPrepaid":false,"money":{"kind":"none"},"accountStatus":9,"accountStatusLabel":"Em período de carência","fetchedAt":"2026-09-30T17:32:00.000Z","connectionKind":"user"}` |
| `16-desativada.png` | `{"adAccountId":"123","name":"Loja Centro","currency":"BRL","isPrepaid":false,"money":{"kind":"owed","amountMajor":1250.5},"accountStatus":2,"accountStatusLabel":"Desativada","fetchedAt":"2026-09-30T17:32:00.000Z","connectionKind":"user"}` |

Erro: `agent-browser network route "**/ad-accounts/*/money*" --abort`, recarregar, fotografar `17-erro.png` (deve mostrar "Não foi possível consultar o saldo" e "Tentar de novo"), `unroute`.

Para cada screenshot, confira no `agent-browser snapshot` que os textos exatos da seção Global Constraints aparecem (ex.: "Saldo disponível", "Fatura em aberto", "R$ 320,00", o motivo BISU/usuário completo, "Atualizado às 14:32").

- [ ] **Step 12: Largura de celular (R14)**

Consulte `agent-browser --help` para a sintaxe de viewport (ex.: `agent-browser set viewport 375 812`). Com o route de `13-bloqueado-bisu` (texto mais longo) ativo, recarregue e rode:

```bash
agent-browser eval "document.documentElement.scrollWidth <= window.innerWidth"
agent-browser screenshot .scratch/meta-ad-account-money/screenshots/18-mobile-bloqueado.png
```

Expected: `true`. Se `false`, descubra o elemento que estoura (ex.: `agent-browser eval` listando elementos com `scrollWidth > clientWidth` dentro do card), corrija no componente com `min-w-0`/`break-words`/`flex-wrap`, recarregue e repita. Volte o viewport ao normal e `unroute`.

- [ ] **Step 13: Log e encerramento do servidor**

Run: `grep -iE "error|unhandled|failed" .scratch/meta-ad-account-money/dev-server.log | grep -i "money\|ad-account" ; echo "exit-grep=$?"`
Expected: nenhum erro da rota nova (`exit-grep=1`). Pare o servidor de dev (encerre o processo em background) e feche o agent-browser (`agent-browser close`).

Escreva `.scratch/meta-ad-account-money/ui-verification.md` com: comando usado para subir, banco alvo confirmado, usuário (mascarado) e tipo de conexão do estado real, a lista de screenshots com o que cada uma mostra, o resultado do teste de largura e qualquer ajuste feito.

- [ ] **Step 14: Portão de qualidade**

```bash
FRONTEND_ROOT=D:/automatize-marketing/automatize-frontend bun test 2>&1 | grep -E "^\(fail\)| pass$| fail$|^Ran "
```

Expected: `8 fail` com exatamente os nomes da baseline (Global Constraints) e `pass` = 1428 + testes novos.

```bash
bunx eslint lib/meta-business/read-cache.test.ts lib/backoffice/ad-account-money-types.ts lib/meta-business/insights/account-status-label.test.ts lib/meta-business/ad-account-money-read.ts lib/meta-business/ad-account-money-read.test.ts lib/meta-business/ad-account-money-handler.ts lib/meta-business/ad-account-money-handler.test.ts "app/api/users/[id]/ad-accounts/[accountId]/money/route.ts" lib/backoffice/describe-ad-account-money.ts lib/backoffice/describe-ad-account-money.test.ts "app/(admin)/marketing/hooks/use-ad-account-money.ts" "app/(admin)/marketing/hooks/use-ad-account-money.test.ts" "app/(admin)/marketing/components/ad-account-money-panel.tsx"
bunx eslint "app/(admin)/marketing/components/marketing-workspace.tsx" lib/meta-business/read-cache.ts lib/meta-business/insights/account.ts 2>&1 | tail -3
bun run build 2>&1 | tail -20
```

Expected: o primeiro `eslint` sem nenhum problema; o segundo com exatamente `✖ 5 problems (4 errors, 1 warning)` (baseline); build termina sem erro e lista a rota `ƒ /api/users/[id]/ad-accounts/[accountId]/money`.

Paridade do espelhamento (no checkout principal do frontend, somente leitura):

```bash
cd D:/automatize-marketing/automatize-frontend && BACKOFFICE_ROOT=D:/automatize-marketing/backoffice-meta-ad-account-money bun run sync:meta:check; cd D:/automatize-marketing/backoffice-meta-ad-account-money
```

Expected: sem divergência (mesmo resultado que o `main` do backoffice dá; se a `main` já divergir, registre a divergência pré-existente no ledger e confirme que nenhum arquivo desta branch aparece nela).

- [ ] **Step 15: Commit de ajustes (se houver)**

Se os Steps 11–14 exigiram correção no componente:

```bash
git add "app/(admin)/marketing/components/ad-account-money-panel.tsx"
git commit -m "fix(backoffice): ajustes de layout do card de saldo/fatura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git status --porcelain` deve ficar limpo (o `.scratch/` é ignorado).

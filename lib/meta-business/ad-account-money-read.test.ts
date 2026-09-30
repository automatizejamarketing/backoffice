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
    // GraphApiError.message é o texto MAPEADO (findMappedError); a mensagem crua da Graph fica em errorReturn.data.
    const error = await readAdAccountMoney({ adAccountId: "123", accessToken: nextToken() }).catch((e) => e);
    expect(error.errorReturn.data.message).toBe("segunda");
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

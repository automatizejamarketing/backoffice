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

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
    expect(body.message).toBe("Não foi possível consultar a Meta agora.");
    expect(body.solution).toBe("Tente de novo em instantes.");
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
  });

  test("autorização que lança → 500 genérico em JSON, sem token nem Meta", async () => {
    const { deps, reads, tokenCalls } = setup({
      authorize: async () => {
        throw new Error("session store down 10.0.0.2");
      },
    });
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "123" }, deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Internal server error",
      message: "Não foi possível consultar a Meta agora.",
      solution: "Tente de novo em instantes.",
    });
    expect(tokenCalls).toEqual([]);
    expect(reads).toEqual([]);
  });

  test("busca de token que lança → 500 genérico em JSON, sem Meta", async () => {
    const { deps, reads } = setup({
      getAccessToken: async () => {
        throw new Error("db timeout");
      },
    });
    const res = await handleAdAccountMoney(req(), { userId: "user-1", accountId: "123" }, deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Internal server error",
      message: "Não foi possível consultar a Meta agora.",
      solution: "Tente de novo em instantes.",
    });
    expect(reads).toEqual([]);
  });
});

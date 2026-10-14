import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
// @ts-expect-error Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import { ensureMetaTestEnv, installMetaFetchStub, type MetaFetchStub } from "../../tests/helpers/meta-fetch-stub";

// Leitura do pixel: só Graph (stub), nunca banco.
const forbidden = new Proxy({}, { get() { throw new Error("unexpected IO"); } });
ensureMetaTestEnv();
mock.module("server-only", () => ({}));
mock.module("@/lib/db", () => ({ db: forbidden, postgresClient: forbidden }));

let readAdAccountPixels: typeof import("./playbook-actions-data").readAdAccountPixels;
let resetMetaReadCacheForTests: typeof import("@/lib/meta-business/read-cache").resetMetaReadCacheForTests;
let stub: MetaFetchStub | undefined;

before(async () => {
  ({ readAdAccountPixels } = await import("./playbook-actions-data"));
  ({ resetMetaReadCacheForTests } = await import("@/lib/meta-business/read-cache"));
});
after(() => stub?.restore());

describe("checagem ao vivo · pixels da conta", () => {
  it("lê act_X/adspixels, normaliza o fuso da Meta e guarda 5 min por conta", async () => {
    resetMetaReadCacheForTests();
    stub = installMetaFetchStub((req) =>
      req.path === "act_123/adspixels"
        ? { body: { data: [{ id: "px1", name: "Pixel Loja", last_fired_time: "2026-10-12T15:04:05+0000", is_unavailable: false }, { id: "px2", is_unavailable: true }] } }
        : undefined,
    );
    const pixels = await readAdAccountPixels({ adAccountId: "123", accessToken: "tok-a" });
    assert.deepEqual(pixels, [
      { id: "px1", name: "Pixel Loja", lastFiredTime: "2026-10-12T15:04:05.000Z", isUnavailable: false },
      { id: "px2", name: null, lastFiredTime: null, isUnavailable: true },
    ]);
    assert.equal(stub.calls[0].method, "GET");
    assert.equal(stub.calls[0].params.get("fields"), "id,name,last_fired_time,is_unavailable");

    await readAdAccountPixels({ adAccountId: "act_123", accessToken: "tok-a" });
    assert.equal(stub.calls.length, 1, "segunda leitura da mesma conta vem do cache");
    await readAdAccountPixels({ adAccountId: "act_123", accessToken: "tok-a", fresh: true });
    assert.equal(stub.calls.length, 2, "Checar agora fura o cache");
    stub.restore();
    stub = undefined;
  });

  it("erro da Meta sobe (a tela mostra 'não consegui checar agora')", async () => {
    resetMetaReadCacheForTests();
    stub = installMetaFetchStub(() => ({ status: 400, body: { error: { message: "Unsupported get request", code: 100 } } }));
    await assert.rejects(readAdAccountPixels({ adAccountId: "999", accessToken: "tok-b" }));
    stub.restore();
    stub = undefined;
  });
});

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

import { describe, expect, test } from "bun:test";

import {
  collectCreativeSnapshots,
  MAX_CREATIVE_FETCH_FAILURES,
  type CreativeSnapshotPorts,
} from "@/lib/meta-tracking/collect-creative-snapshots";
import {
  MAX_CREATIVES_PER_ACCOUNT_RUN,
  type CreativeSnapshotRow,
} from "@/lib/meta-tracking/creative-snapshot";
import { UNKNOWN_QUOTA_USAGE } from "@/lib/meta-tracking/quota-usage";
import {
  adCreativeV25,
  FIXTURE_ACCOUNT_ID,
  FIXTURE_CREATIVE_ID,
  FIXTURE_USER_ID,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";
import {
  findMappedError,
  GraphApiError,
  MetaTokenInvalidError,
} from "@/lib/meta-business/error";

const ARGS = {
  userId: FIXTURE_USER_ID,
  accountId: FIXTURE_ACCOUNT_ID,
  credentials: { accessToken: "token-de-teste" },
};

function appRateLimitError(): GraphApiError {
  return new GraphApiError({
    statusCode: 403,
    reason: findMappedError(4, 1504022),
    data: {
      message: "Application request limit reached",
      type: "OAuthException",
      code: 4,
      errorSubcode: 1504022,
    },
  });
}

type Recorded = {
  /** Cada node batch pedido à Meta, na ordem. */
  batches: string[][];
  /** O "banco" de snapshots, chaveado pelo id do criativo. */
  store: Map<string, CreativeSnapshotRow>;
};

function makePorts(
  options: {
    unknownIds?: string[];
    overrides?: Partial<CreativeSnapshotPorts>;
  } = {},
): { ports: CreativeSnapshotPorts; recorded: Recorded } {
  const recorded: Recorded = { batches: [], store: new Map() };

  const ports: CreativeSnapshotPorts = {
    listUnknownCreativeIds: async () =>
      options.unknownIds ?? [FIXTURE_CREATIVE_ID],
    fetchCreatives: async ({ creativeIds }) => {
      recorded.batches.push([...creativeIds]);
      return {
        creatives: creativeIds.map((id) => adCreativeV25({ id })),
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      };
    },
    // O insert real é `ON CONFLICT (id) DO NOTHING`: o que já existe não conta.
    insertCreatives: async (rows) => {
      let inserted = 0;
      for (const row of rows) {
        if (recorded.store.has(row.id)) continue;
        recorded.store.set(row.id, row);
        inserted += 1;
      }
      return inserted;
    },
    ...options.overrides,
  };

  return { ports, recorded };
}

describe("collectCreativeSnapshots", () => {
  test("o criativo desconhecido é buscado em lote e gravado com o conteúdo íntegro", async () => {
    const { ports, recorded } = makePorts();

    const result = await collectCreativeSnapshots(ports, ARGS);

    expect(recorded.batches).toEqual([[FIXTURE_CREATIVE_ID]]);
    expect(recorded.store.get(FIXTURE_CREATIVE_ID)).toEqual({
      id: FIXTURE_CREATIVE_ID,
      accountId: FIXTURE_ACCOUNT_ID,
      spec: adCreativeV25(),
    });
    expect(result).toMatchObject({
      creativesFetched: 1,
      creativesPending: 0,
      apiCalls: 1,
      failureMessage: null,
    });
  });

  test("criativo já presente na tabela não é rebuscado: a segunda passada não chama a Meta", async () => {
    // A varredura pergunta ao banco quem ainda não tem snapshot — depois da
    // primeira captura, a conta não tem mais nada a buscar.
    const captured = new Set<string>();
    const { ports, recorded } = makePorts({
      overrides: {
        listUnknownCreativeIds: async () =>
          captured.has(FIXTURE_CREATIVE_ID) ? [] : [FIXTURE_CREATIVE_ID],
        insertCreatives: async (rows) => {
          for (const row of rows) captured.add(row.id);
          return rows.length;
        },
      },
    });

    await collectCreativeSnapshots(ports, ARGS);
    const segunda = await collectCreativeSnapshots(ports, ARGS);

    expect(recorded.batches).toHaveLength(1);
    expect(segunda).toMatchObject({
      creativesFetched: 0,
      creativesPending: 0,
      apiCalls: 0,
    });
  });

  test("o passivo acima do teto por execução fica pendente para a próxima", async () => {
    const unknownIds = Array.from(
      { length: MAX_CREATIVES_PER_ACCOUNT_RUN + 20 },
      (_, i) => `creative-${i}`,
    );
    const { ports, recorded } = makePorts({ unknownIds });

    const result = await collectCreativeSnapshots(ports, ARGS);

    expect(recorded.store.size).toBe(MAX_CREATIVES_PER_ACCOUNT_RUN);
    expect(result.creativesPending).toBe(20);
  });

  test("cota apertada interrompe entre lotes e o que sobrou fica pendente", async () => {
    const unknownIds = Array.from({ length: 120 }, (_, i) => `creative-${i}`);
    const { ports, recorded } = makePorts({
      unknownIds,
      overrides: {
        fetchCreatives: async ({ creativeIds }) => {
          recorded.batches.push([...creativeIds]);
          return {
            creatives: creativeIds.map((id) => adCreativeV25({ id })),
            usage: { utilizationPercent: 92, estimatedRegainMs: null },
            apiCalls: 1,
          };
        },
      },
    });

    const result = await collectCreativeSnapshots(ports, ARGS);

    expect(recorded.batches).toHaveLength(1);
    expect(result).toMatchObject({
      creativesFetched: 50,
      creativesPending: 70,
      stoppedForQuota: true,
    });
  });

  test("lote recusado pela Meta não impede os outros; os ids dele ficam pendentes", async () => {
    const unknownIds = Array.from({ length: 100 }, (_, i) => `creative-${i}`);
    const { ports, recorded } = makePorts({
      unknownIds,
      overrides: {
        fetchCreatives: async ({ creativeIds }) => {
          recorded.batches.push([...creativeIds]);
          if (recorded.batches.length === 1) {
            throw new Error("(#100) Unsupported get request");
          }
          return {
            creatives: creativeIds.map((id) => adCreativeV25({ id })),
            usage: UNKNOWN_QUOTA_USAGE,
            apiCalls: 1,
          };
        },
      },
    });

    const result = await collectCreativeSnapshots(ports, ARGS);

    expect(recorded.batches).toHaveLength(2);
    expect(recorded.store.size).toBe(50);
    expect(result).toMatchObject({ creativesFetched: 50, creativesPending: 50 });
    expect(result.failureMessage).toContain("Unsupported get request");
  });

  test("Graph 190 não é engolido como falha de criativo", async () => {
    const invalid = new MetaTokenInvalidError(
      "Sessão invalidada",
      190,
      460,
    );
    const { ports } = makePorts({
      overrides: {
        fetchCreatives: async () => {
          throw invalid;
        },
      },
    });

    await expect(collectCreativeSnapshots(ports, ARGS)).rejects.toBe(invalid);
  });

  test("recusas seguidas encerram a conta no dia em vez de multiplicar erros", async () => {
    const unknownIds = Array.from({ length: 300 }, (_, i) => `creative-${i}`);
    const { ports, recorded } = makePorts({
      unknownIds,
      overrides: {
        fetchCreatives: async ({ creativeIds }) => {
          recorded.batches.push([...creativeIds]);
          throw new Error("(#17) User request limit reached");
        },
      },
    });

    const result = await collectCreativeSnapshots(ports, ARGS);

    expect(recorded.batches).toHaveLength(MAX_CREATIVE_FETCH_FAILURES);
    expect(result).toMatchObject({ creativesFetched: 0, creativesPending: 300 });
  });

  test("code 4 encerra no primeiro lote e propaga o breaker global", async () => {
    const unknownIds = Array.from({ length: 120 }, (_, i) => `creative-${i}`);
    const { ports, recorded } = makePorts({
      unknownIds,
      overrides: {
        fetchCreatives: async ({ creativeIds }) => {
          recorded.batches.push([...creativeIds]);
          throw appRateLimitError();
        },
      },
    });

    const result = await collectCreativeSnapshots(ports, ARGS);

    expect(recorded.batches).toHaveLength(1);
    expect(result).toMatchObject({
      creativesFetched: 0,
      creativesPending: 120,
      stoppedForQuota: true,
      appRateLimitEvents: 1,
    });
  });

  test("id que a Meta não devolve continua pendente em vez de sumir", async () => {
    const { ports, recorded } = makePorts({
      unknownIds: [FIXTURE_CREATIVE_ID, "criativo-que-sumiu"],
      overrides: {
        fetchCreatives: async ({ creativeIds }) => {
          recorded.batches.push([...creativeIds]);
          return {
            creatives: [adCreativeV25()],
            usage: UNKNOWN_QUOTA_USAGE,
            apiCalls: 1,
          };
        },
      },
    });

    const result = await collectCreativeSnapshots(ports, ARGS);

    expect(recorded.store.size).toBe(1);
    expect(result).toMatchObject({ creativesFetched: 1, creativesPending: 1 });
  });

  test("conta sem criativo desconhecido não fala com a Meta", async () => {
    const { ports, recorded } = makePorts({ unknownIds: [] });

    const result = await collectCreativeSnapshots(ports, ARGS);

    expect(recorded.batches).toEqual([]);
    expect(result).toMatchObject({
      creativesFetched: 0,
      creativesPending: 0,
      apiCalls: 0,
    });
  });

  test("a cota gasta na busca volta para o orquestrador", async () => {
    const { ports } = makePorts({
      overrides: {
        fetchCreatives: async () => ({
          creatives: [],
          usage: { utilizationPercent: 41, estimatedRegainMs: null },
          apiCalls: 2,
        }),
      },
    });

    const result = await collectCreativeSnapshots(ports, ARGS);

    expect(result.usage.utilizationPercent).toBe(41);
    expect(result.apiCalls).toBe(2);
  });
});

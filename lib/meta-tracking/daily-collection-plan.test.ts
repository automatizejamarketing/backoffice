import { describe, expect, test } from "bun:test";

import {
  buildTrackedEntityStates,
  chunkIds,
  coverageStatusForCollectionError,
  coverageStatusForTokenFailure,
  DEEP_FETCH_CHUNK_SIZE,
  hasCollectionBudgetLeft,
  isDayCoveredBy,
  LISTING_EFFECTIVE_STATUSES,
  planDeepFetch,
  type ListedEntity,
  type TrackedEntityState,
} from "@/lib/meta-tracking/daily-collection-plan";

const CAMPAIGN_ID = "120250000000000101";
const ADSET_ID = "120250000000000201";
const AD_ID = "120250000000000301";

function listed(
  overrides: Partial<ListedEntity> &
    Pick<ListedEntity, "entityLevel" | "entityId">,
): ListedEntity {
  return {
    name: "Entidade",
    effectiveStatus: "ACTIVE",
    status: "ACTIVE",
    ...overrides,
  };
}

function stateWithVersion(
  entityLevel: TrackedEntityState["entityLevel"],
  entityId: string,
  confirmedAt: Date,
): TrackedEntityState {
  return {
    entityLevel,
    entityId,
    lastEffectiveStatus: "ACTIVE",
    confirmedAt,
    currentVersion: {
      id: `version-${entityId}`,
      versionNumber: 1,
      configHash: "hash",
      isManaged: false,
      config: { id: entityId },
    },
  };
}

describe("planDeepFetch", () => {
  test("só entidade com entrega ativa recebe fetch profundo", () => {
    const plan = planDeepFetch({
      listing: [
        listed({ entityLevel: "campaign", entityId: CAMPAIGN_ID }),
        listed({
          entityLevel: "adset",
          entityId: ADSET_ID,
          effectiveStatus: "CAMPAIGN_PAUSED",
        }),
        listed({
          entityLevel: "ad",
          entityId: AD_ID,
          effectiveStatus: "ARCHIVED",
        }),
      ],
      previous: [],
    });

    expect(plan.chunks).toEqual([
      { entityLevel: "campaign", entityIds: [CAMPAIGN_ID] },
    ]);
    expect(plan.activeSeen).toBe(1);
  });

  test("pausada COM versão do baseline continua fora do fetch profundo até reativar", () => {
    // O backfill dá versão inicial a pausadas e arquivadas (§6 do plano). Isso
    // não pode fazer o coletor diário passar a buscá-las todo dia: quem não
    // gasta não tem configuração mudando, e a cota é da conta.
    const plan = planDeepFetch({
      listing: [
        listed({
          entityLevel: "campaign",
          entityId: CAMPAIGN_ID,
          effectiveStatus: "PAUSED",
        }),
      ],
      previous: [
        stateWithVersion("campaign", CAMPAIGN_ID, new Date("2026-08-01T00:00:00Z")),
      ],
    });

    expect(plan.chunks).toEqual([]);
    expect(plan.activeSeen).toBe(0);
  });

  test("campanha entra sempre — o carimbo de atualização dela não é confiável", () => {
    const plan = planDeepFetch({
      listing: [
        listed({
          entityLevel: "campaign",
          entityId: CAMPAIGN_ID,
          updatedTime: new Date("2020-01-01T00:00:00Z"),
        }),
      ],
      previous: [
        stateWithVersion(
          "campaign",
          CAMPAIGN_ID,
          new Date("2026-08-08T08:00:00Z"),
        ),
      ],
    });

    expect(plan.chunks).toEqual([
      { entityLevel: "campaign", entityIds: [CAMPAIGN_ID] },
    ]);
    expect(plan.prefiltered).toBe(0);
  });

  test("conjunto sem alteração desde a última confirmação é pré-filtrado", () => {
    const plan = planDeepFetch({
      listing: [
        listed({
          entityLevel: "adset",
          entityId: ADSET_ID,
          updatedTime: new Date("2026-08-07T10:00:00Z"),
        }),
      ],
      previous: [
        stateWithVersion("adset", ADSET_ID, new Date("2026-08-08T08:00:00Z")),
      ],
    });

    expect(plan.chunks).toEqual([]);
    expect(plan.prefiltered).toBe(1);
  });

  test("anúncio alterado depois da última confirmação volta ao fetch profundo", () => {
    const plan = planDeepFetch({
      listing: [
        listed({
          entityLevel: "ad",
          entityId: AD_ID,
          updatedTime: new Date("2026-08-08T09:30:00Z"),
        }),
      ],
      previous: [
        stateWithVersion("ad", AD_ID, new Date("2026-08-08T08:00:00Z")),
      ],
    });

    expect(plan.chunks).toEqual([{ entityLevel: "ad", entityIds: [AD_ID] }]);
    expect(plan.prefiltered).toBe(0);
  });

  test("ativo sem versão vigente entra mesmo com carimbo antigo (reativação em cascata não mexe no updated_time do filho)", () => {
    const plan = planDeepFetch({
      listing: [
        listed({
          entityLevel: "adset",
          entityId: ADSET_ID,
          updatedTime: new Date("2020-01-01T00:00:00Z"),
        }),
      ],
      previous: [
        {
          entityLevel: "adset",
          entityId: ADSET_ID,
          lastEffectiveStatus: "CAMPAIGN_PAUSED",
          confirmedAt: null,
          currentVersion: null,
        },
      ],
    });

    expect(plan.chunks).toEqual([
      { entityLevel: "adset", entityIds: [ADSET_ID] },
    ]);
  });

  test("sem carimbo de atualização na listagem não há pré-filtro possível", () => {
    const plan = planDeepFetch({
      listing: [listed({ entityLevel: "adset", entityId: ADSET_ID })],
      previous: [
        stateWithVersion("adset", ADSET_ID, new Date("2026-08-08T08:00:00Z")),
      ],
    });

    expect(plan.chunks).toEqual([
      { entityLevel: "adset", entityIds: [ADSET_ID] },
    ]);
  });

  test("o node batch é quebrado em lotes do tamanho suportado, por nível", () => {
    const listing = Array.from({ length: DEEP_FETCH_CHUNK_SIZE + 3 }, (_, i) =>
      listed({ entityLevel: "ad", entityId: `ad-${i}` }),
    );

    const plan = planDeepFetch({ listing, previous: [] });

    expect(plan.chunks).toHaveLength(2);
    expect(plan.chunks[0].entityIds).toHaveLength(DEEP_FETCH_CHUNK_SIZE);
    expect(plan.chunks[1].entityIds).toHaveLength(3);
    expect(plan.chunks.every((c) => c.entityLevel === "ad")).toBe(true);
  });
});

describe("LISTING_EFFECTIVE_STATUSES", () => {
  test("os três níveis pedem arquivadas — sem pedir, o edge as omite e o arquivamento nunca é reportado", () => {
    for (const level of ["campaign", "adset", "ad"] as const) {
      expect(LISTING_EFFECTIVE_STATUSES[level]).toContain("ARCHIVED");
      expect(LISTING_EFFECTIVE_STATUSES[level]).toContain("ACTIVE");
    }
  });

  test("nenhum nível pede DELETED — a Meta rejeita a requisição inteira (subcódigo 1815001)", () => {
    // Medido contra a v25 nos três edges: com `DELETED` no filtro a resposta é
    // 400 e a listagem do nível se perde por completo, não só as removidas.
    for (const level of ["campaign", "adset", "ad"] as const) {
      expect(LISTING_EFFECTIVE_STATUSES[level]).not.toContain("DELETED");
    }
  });

  test("cascata de pausa do pai só é pedida onde existe", () => {
    expect(LISTING_EFFECTIVE_STATUSES.campaign).not.toContain(
      "CAMPAIGN_PAUSED",
    );
    expect(LISTING_EFFECTIVE_STATUSES.adset).toContain("CAMPAIGN_PAUSED");
    expect(LISTING_EFFECTIVE_STATUSES.ad).toContain("ADSET_PAUSED");
  });
});

describe("buildTrackedEntityStates", () => {
  test("a versão vigente vira o estado anterior da entidade", () => {
    const [state] = buildTrackedEntityStates({
      versions: [
        {
          id: "v1",
          entityLevel: "campaign",
          entityId: CAMPAIGN_ID,
          versionNumber: 3,
          configHash: "abc",
          isManaged: true,
          config: { id: CAMPAIGN_ID },
          effectiveStatus: "ACTIVE",
          lastConfirmedAt: new Date("2026-08-08T08:00:00Z"),
        },
      ],
      lifecycle: [],
    });

    expect(state.currentVersion).toEqual({
      id: "v1",
      versionNumber: 3,
      configHash: "abc",
      isManaged: true,
      config: { id: CAMPAIGN_ID },
    });
    expect(state.lastEffectiveStatus).toBe("ACTIVE");
    expect(state.confirmedAt).toEqual(new Date("2026-08-08T08:00:00Z"));
  });

  test("entidade que nunca esteve ativa existe no estado anterior pelo stream de eventos", () => {
    const [state] = buildTrackedEntityStates({
      versions: [],
      lifecycle: [
        {
          entityLevel: "adset",
          entityId: ADSET_ID,
          effectiveStatus: "PAUSED",
          occurredAt: new Date("2026-08-07T08:00:00Z"),
        },
      ],
    });

    expect(state.currentVersion ?? null).toBeNull();
    expect(state.lastEffectiveStatus).toBe("PAUSED");
    expect(state.confirmedAt).toBeNull();
  });

  test("transição mais nova que a última confirmação vence a coluna volátil da versão", () => {
    const [state] = buildTrackedEntityStates({
      versions: [
        {
          id: "v1",
          entityLevel: "adset",
          entityId: ADSET_ID,
          versionNumber: 1,
          configHash: "abc",
          isManaged: false,
          config: {},
          // Congelado no último fetch profundo: quem pausa some do fetch.
          effectiveStatus: "ACTIVE",
          lastConfirmedAt: new Date("2026-08-05T08:00:00Z"),
        },
      ],
      lifecycle: [
        {
          entityLevel: "adset",
          entityId: ADSET_ID,
          effectiveStatus: "PAUSED",
          occurredAt: new Date("2026-08-06T08:00:00Z"),
        },
      ],
    });

    expect(state.lastEffectiveStatus).toBe("PAUSED");
    expect(state.currentVersion?.id).toBe("v1");
  });

  test("confirmação mais nova que a última transição vence o evento antigo", () => {
    const [state] = buildTrackedEntityStates({
      versions: [
        {
          id: "v1",
          entityLevel: "adset",
          entityId: ADSET_ID,
          versionNumber: 1,
          configHash: "abc",
          isManaged: false,
          config: {},
          effectiveStatus: "ACTIVE",
          lastConfirmedAt: new Date("2026-08-08T08:00:00Z"),
        },
      ],
      lifecycle: [
        {
          entityLevel: "adset",
          entityId: ADSET_ID,
          effectiveStatus: "PAUSED",
          occurredAt: new Date("2026-08-06T08:00:00Z"),
        },
      ],
    });

    expect(state.lastEffectiveStatus).toBe("ACTIVE");
  });

  test("entidades de níveis diferentes com o mesmo id não se misturam", () => {
    const states = buildTrackedEntityStates({
      versions: [],
      lifecycle: [
        {
          entityLevel: "adset",
          entityId: "123",
          effectiveStatus: "PAUSED",
          occurredAt: new Date("2026-08-06T08:00:00Z"),
        },
        {
          entityLevel: "ad",
          entityId: "123",
          effectiveStatus: "ACTIVE",
          occurredAt: new Date("2026-08-06T08:00:00Z"),
        },
      ],
    });

    expect(states).toHaveLength(2);
  });
});

describe("isDayCoveredBy", () => {
  test("conta já completa hoje não é recoletada", () => {
    expect(isDayCoveredBy("complete")).toBe(true);
  });

  test("pulada por reconexão pendente não é reprocessada no mesmo dia", () => {
    expect(isDayCoveredBy("skipped_reconnect")).toBe(true);
    expect(isDayCoveredBy("skipped_no_token")).toBe(true);
  });

  test("parcial fica pendente para o próximo disparo completar", () => {
    expect(isDayCoveredBy("partial")).toBe(false);
    expect(isDayCoveredBy(null)).toBe(false);
  });

  test("falha não é reinsistida no mesmo dia — a licença é throttled por taxa de erro", () => {
    expect(isDayCoveredBy("failed")).toBe(true);
  });
});

describe("coverageStatusForCollectionError", () => {
  function graphError(code: number): unknown {
    return {
      name: "GraphApiError",
      errorReturn: { statusCode: 403, data: { code, errorSubcode: 1504022 } },
    };
  }

  test("throttle fica PENDENTE — o disparo seguinte é o resfriamento que a Meta pediu", () => {
    // `partial` não é terminal: é o que faz a conta voltar em 20 minutos em vez
    // de perder o dia inteiro por um erro que a Meta marca como transitório.
    for (const code of [4, 17, 32, 341, 613, 80000]) {
      expect(coverageStatusForCollectionError(graphError(code))).toBe("partial");
      expect(isDayCoveredBy(coverageStatusForCollectionError(graphError(code)))).toBe(false);
    }
  });

  test("erro que não é throttle encerra o dia da conta", () => {
    // Insistir num erro permanente a cada disparo só piora a taxa de erro, que
    // é justamente o que a licença do app mede.
    expect(coverageStatusForCollectionError(graphError(100))).toBe("failed");
    expect(coverageStatusForCollectionError(new Error("banco fora"))).toBe("failed");
    expect(coverageStatusForCollectionError(null)).toBe("failed");
    expect(coverageStatusForCollectionError({ errorReturn: {} })).toBe("failed");
  });
});

describe("coverageStatusForTokenFailure", () => {
  test("reconexão pendente é registrada como tal — é buraco irrecuperável", () => {
    expect(coverageStatusForTokenFailure({ needsReconnect: true })).toBe(
      "skipped_reconnect",
    );
  });

  test("ausência de token conectado é outro caso e tem status próprio", () => {
    expect(coverageStatusForTokenFailure({ needsReconnect: false })).toBe(
      "skipped_no_token",
    );
    expect(coverageStatusForTokenFailure({})).toBe("skipped_no_token");
  });
});

describe("hasCollectionBudgetLeft", () => {
  const startedAt = new Date("2026-08-09T08:00:00Z");

  test("dentro do lote e do prazo o disparo continua drenando", () => {
    expect(
      hasCollectionBudgetLeft({
        startedAt,
        now: new Date("2026-08-09T08:01:00Z"),
        accountsProcessed: 3,
        maxAccounts: 10,
        softDeadlineMs: 240_000,
      }),
    ).toBe(true);
  });

  test("lote cheio encerra o disparo e deixa o resto para o próximo", () => {
    expect(
      hasCollectionBudgetLeft({
        startedAt,
        now: new Date("2026-08-09T08:01:00Z"),
        accountsProcessed: 10,
        maxAccounts: 10,
        softDeadlineMs: 240_000,
      }),
    ).toBe(false);
  });

  test("prazo estourado encerra o disparo antes de a plataforma matar a invocação", () => {
    expect(
      hasCollectionBudgetLeft({
        startedAt,
        now: new Date("2026-08-09T08:04:01Z"),
        accountsProcessed: 1,
        maxAccounts: 10,
        softDeadlineMs: 240_000,
      }),
    ).toBe(false);
  });
});

describe("chunkIds", () => {
  test("lista vazia não vira lote nenhum", () => {
    expect(chunkIds([], 50)).toEqual([]);
  });

  test("o último lote carrega o resto", () => {
    expect(chunkIds(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });
});

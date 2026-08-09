import { describe, expect, test } from "bun:test";

import {
  BACKFILL_MONTHS,
  backfillTargetRange,
  hasApiCallBudgetLeft,
  mergeBackfillProgress,
  mergeDayRanges,
  parseBackfillProgress,
  planAccountBackfill,
  planBaselineFetch,
  sliceDayRange,
  subtractDayRanges,
  withSliceCovered,
} from "@/lib/meta-tracking/backfill-plan";
import { METRICS_MUTABLE_DAYS, rangeDays } from "@/lib/meta-tracking/daily-metrics";
import type { ListedEntity } from "@/lib/meta-tracking/daily-collection-plan";

const TODAY = "2026-08-09";

function listed(overrides: Partial<ListedEntity> & { entityId: string }): ListedEntity {
  return {
    entityLevel: "campaign",
    name: "Campanha",
    campaignId: null,
    adsetId: null,
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    ...overrides,
  };
}

describe("backfillTargetRange", () => {
  test("cobre 13 meses e para onde a janela móvel do coletor diário começa", () => {
    const range = backfillTargetRange(TODAY);

    expect(range).toEqual({ since: "2025-07-09", until: "2026-07-11" });
    // O dia seguinte ao fim do backfill é o primeiro dia que a coleta diária
    // ainda re-escreve — nenhum dia fica sem dono e nenhum é disputado.
    expect(range.until).toBe("2026-07-11");
    expect(METRICS_MUTABLE_DAYS).toBe(28);
    expect(BACKFILL_MONTHS).toBe(13);
  });

  test("o dia do mês é preservado ao voltar 13 meses, sem estourar mês curto", () => {
    // 31 de março menos 13 meses cairia em "29 de fevereiro" de um ano comum.
    expect(backfillTargetRange("2027-03-31").since).toBe("2026-02-28");
  });

  test("nenhum dia do backfill está dentro da janela mutável de 28 dias", () => {
    // A regra que sustenta `is_final = true`: o backfill só toca dia congelado.
    expect(backfillTargetRange(TODAY).until < "2026-07-12").toBe(true);
  });
});

describe("mergeDayRanges", () => {
  test("períodos sobrepostos e encostados viram um só", () => {
    expect(
      mergeDayRanges([
        { since: "2026-03-01", until: "2026-03-10" },
        { since: "2026-03-11", until: "2026-03-20" },
        { since: "2026-03-05", until: "2026-03-08" },
      ]),
    ).toEqual([{ since: "2026-03-01", until: "2026-03-20" }]);
  });

  test("buraco entre dois períodos é preservado e a saída sai ordenada", () => {
    expect(
      mergeDayRanges([
        { since: "2026-04-01", until: "2026-04-05" },
        { since: "2026-03-01", until: "2026-03-05" },
      ]),
    ).toEqual([
      { since: "2026-03-01", until: "2026-03-05" },
      { since: "2026-04-01", until: "2026-04-05" },
    ]);
  });

  test("período invertido é descartado em vez de contaminar a cobertura", () => {
    expect(
      mergeDayRanges([{ since: "2026-03-10", until: "2026-03-01" }]),
    ).toEqual([]);
  });
});

describe("subtractDayRanges", () => {
  test("o que já foi coberto some do alvo e o resto continua pendente", () => {
    expect(
      subtractDayRanges({ since: "2026-01-01", until: "2026-01-31" }, [
        { since: "2026-01-10", until: "2026-01-20" },
      ]),
    ).toEqual([
      { since: "2026-01-01", until: "2026-01-09" },
      { since: "2026-01-21", until: "2026-01-31" },
    ]);
  });

  test("cobertura que engloba o alvo não deixa nada a fazer", () => {
    expect(
      subtractDayRanges({ since: "2026-01-01", until: "2026-01-31" }, [
        { since: "2025-01-01", until: "2027-01-01" },
      ]),
    ).toEqual([]);
  });

  test("cobertura fora do alvo não encolhe o que falta", () => {
    const target = { since: "2026-01-01", until: "2026-01-31" };
    expect(
      subtractDayRanges(target, [{ since: "2025-11-01", until: "2025-12-31" }]),
    ).toEqual([target]);
  });
});

describe("sliceDayRange", () => {
  test("fatia do mais recente para o mais antigo: história recente primeiro", () => {
    // Se o backfill nunca terminar, o que já entrou é o passado mais próximo —
    // o mais parecido com o presente e o mais útil para decidir hoje.
    expect(sliceDayRange({ since: "2026-01-01", until: "2026-01-25" }, 10)).toEqual([
      { since: "2026-01-16", until: "2026-01-25" },
      { since: "2026-01-06", until: "2026-01-15" },
      { since: "2026-01-01", until: "2026-01-05" },
    ]);
  });

  test("período menor que a fatia sai inteiro", () => {
    expect(sliceDayRange({ since: "2026-01-01", until: "2026-01-03" }, 31)).toEqual([
      { since: "2026-01-01", until: "2026-01-03" },
    ]);
  });

  test("período invertido não vira fatia nenhuma", () => {
    expect(sliceDayRange({ since: "2026-01-10", until: "2026-01-01" }, 31)).toEqual([]);
  });
});

describe("planAccountBackfill", () => {
  test("conta nunca backfillada tem os 13 meses inteiros fatiados", () => {
    const plan = planAccountBackfill({ today: TODAY, covered: [], sliceDays: 31 });

    expect(plan.targetDays).toBe(368);
    expect(plan.remainingDays).toBe(368);
    expect(plan.slices[0]).toEqual({ since: "2026-06-11", until: "2026-07-11" });
    expect(plan.slices.at(-1)?.since).toBe("2025-07-09");
    // Nenhum dia perdido nem repetido: as fatias, juntas, são exatamente o alvo.
    expect(mergeDayRanges(plan.slices)).toEqual([
      { since: "2025-07-09", until: "2026-07-11" },
    ]);
    expect(plan.slices.reduce((total, slice) => total + rangeDays(slice), 0)).toBe(
      368,
    );
  });

  test("retomada não refaz período completo: só o que falta vira fatia", () => {
    const plan = planAccountBackfill({
      today: TODAY,
      covered: [{ since: "2025-12-01", until: "2026-07-11" }],
      sliceDays: 31,
    });

    expect(plan.slices.every((slice) => slice.until < "2025-12-01")).toBe(true);
    expect(plan.remainingDays).toBe(145);
    expect(plan.slices[0]).toEqual({ since: "2025-10-31", until: "2025-11-30" });
  });

  test("cobertura completa não deixa fatia nenhuma — o backfill terminou", () => {
    const plan = planAccountBackfill({
      today: TODAY,
      covered: [{ since: "2024-01-01", until: "2026-08-09" }],
    });

    expect(plan.slices).toEqual([]);
    expect(plan.remainingDays).toBe(0);
  });

  test("o teto de fatias por invocação limita a noite sem perder o resto", () => {
    const plan = planAccountBackfill({
      today: TODAY,
      covered: [],
      sliceDays: 31,
      maxSlices: 2,
    });

    expect(plan.slices).toHaveLength(2);
    // O que sobrou continua contado como pendente: a próxima noite o pega.
    expect(plan.remainingDays).toBe(368);
  });
});

describe("planBaselineFetch", () => {
  test("pausadas e arquivadas entram no baseline; removidas não", () => {
    const chunks = planBaselineFetch({
      listing: [
        listed({ entityId: "c1", effectiveStatus: "ACTIVE" }),
        listed({ entityId: "c2", effectiveStatus: "PAUSED" }),
        listed({ entityId: "c3", effectiveStatus: "ARCHIVED" }),
        listed({ entityId: "c4", effectiveStatus: "DELETED" }),
        listed({
          entityId: "a1",
          entityLevel: "adset",
          effectiveStatus: "CAMPAIGN_PAUSED",
          campaignId: "c2",
        }),
      ],
    });

    expect(chunks).toEqual([
      { entityLevel: "campaign", entityIds: ["c1", "c2", "c3"] },
      { entityLevel: "adset", entityIds: ["a1"] },
    ]);
  });

  test("os lotes respeitam o teto do node batch da Graph API", () => {
    const chunks = planBaselineFetch({
      listing: Array.from({ length: 5 }, (_, i) => listed({ entityId: `c${i}` })),
      chunkSize: 2,
    });

    expect(chunks.map((chunk) => chunk.entityIds.length)).toEqual([2, 2, 1]);
  });
});

describe("hasApiCallBudgetLeft", () => {
  test("o orçamento da noite fecha a conta antes de competir com o coletor diário", () => {
    expect(hasApiCallBudgetLeft({ apiCallsUsed: 299, maxApiCalls: 300 })).toBe(true);
    expect(hasApiCallBudgetLeft({ apiCallsUsed: 300, maxApiCalls: 300 })).toBe(false);
  });
});

describe("parseBackfillProgress", () => {
  test("o progresso gravado no summary do run volta normalizado e mesclado", () => {
    expect(
      parseBackfillProgress({
        covered: [
          { since: "2026-01-01", until: "2026-01-31" },
          { since: "2026-02-01", until: "2026-02-28" },
        ],
        baselineCompletedAt: "2026-08-09T05:00:00.000Z",
      }),
    ).toEqual({
      covered: [{ since: "2026-01-01", until: "2026-02-28" }],
      baselineCompletedAt: "2026-08-09T05:00:00.000Z",
    });
  });

  test("summary ausente ou corrompido vira progresso vazio, não exceção", () => {
    expect(parseBackfillProgress(undefined)).toEqual({
      covered: [],
      baselineCompletedAt: null,
    });
    expect(
      parseBackfillProgress({ covered: "tudo", baselineCompletedAt: 7 }),
    ).toEqual({ covered: [], baselineCompletedAt: null });
    expect(
      parseBackfillProgress({ covered: [{ since: "ontem", until: "hoje" }] }),
    ).toEqual({ covered: [], baselineCompletedAt: null });
  });
});

describe("mergeBackfillProgress", () => {
  test("o progresso de várias noites vira um só, com o baseline mais antigo", () => {
    expect(
      mergeBackfillProgress([
        {
          covered: [{ since: "2026-03-01", until: "2026-03-31" }],
          baselineCompletedAt: "2026-08-02T05:00:00.000Z",
        },
        {
          covered: [{ since: "2026-04-01", until: "2026-04-30" }],
          baselineCompletedAt: null,
        },
        {
          covered: [{ since: "2026-01-01", until: "2026-01-31" }],
          baselineCompletedAt: "2026-08-01T05:00:00.000Z",
        },
      ]),
    ).toEqual({
      // O baseline é fato datado: a primeira noite que o fez é a que responde.
      baselineCompletedAt: "2026-08-01T05:00:00.000Z",
      covered: [
        { since: "2026-01-01", until: "2026-01-31" },
        { since: "2026-03-01", until: "2026-04-30" },
      ],
    });
  });
});

describe("withSliceCovered", () => {
  test("a fatia concluída entra no progresso e se funde com o que já havia", () => {
    const progress = withSliceCovered(
      { covered: [{ since: "2026-02-01", until: "2026-02-28" }], baselineCompletedAt: null },
      { since: "2026-03-01", until: "2026-03-31" },
    );

    expect(progress.covered).toEqual([{ since: "2026-02-01", until: "2026-03-31" }]);
  });
});

import { describe, expect, test } from "bun:test";

import {
  collectDailyMetrics,
  type DailyMetricsPorts,
} from "@/lib/meta-tracking/collect-daily-metrics";
import {
  metricsWindowFor,
  type DailyMetricRow,
  type InsightsRange,
} from "@/lib/meta-tracking/daily-metrics";
import { UNKNOWN_QUOTA_USAGE, type QuotaUsage } from "@/lib/meta-tracking/quota-usage";
import {
  FIXTURE_ACCOUNT_ID,
  FIXTURE_AD_ID,
  FIXTURE_ADSET_ID,
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_USER_ID,
  insightsDayV25,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";
import type { MetaTrackingEntityLevel } from "@/lib/db/schema";

const TODAY = "2026-08-09";
const WINDOW = metricsWindowFor(TODAY);

const ARGS = {
  userId: FIXTURE_USER_ID,
  accountId: FIXTURE_ACCOUNT_ID,
  credentials: { accessToken: "token-de-teste" },
  today: TODAY,
};

/** O erro que a Meta devolve quando o relatório passaria do teto de linhas. */
function rowLimitError(): Error {
  const error = new Error("Please reduce the amount of data you're asking for");
  Object.assign(error, {
    errorReturn: { statusCode: 400, data: { code: 100, errorSubcode: 1487534 } },
  });
  return error;
}

/** Um dia de insights com o id do nível pedido — como a Meta devolve. */
function dayFor(entityLevel: MetaTrackingEntityLevel, date: string) {
  if (entityLevel === "campaign") return insightsDayV25({ date_start: date, date_stop: date });
  if (entityLevel === "adset") {
    return insightsDayV25({
      date_start: date,
      date_stop: date,
      adset_id: FIXTURE_ADSET_ID,
    });
  }
  return insightsDayV25({
    date_start: date,
    date_stop: date,
    adset_id: FIXTURE_ADSET_ID,
    ad_id: FIXTURE_AD_ID,
  });
}

type Asked = { entityLevel: MetaTrackingEntityLevel; range: InsightsRange };

function makePorts(
  overrides: Partial<DailyMetricsPorts> = {},
  usageByLevel: Partial<Record<MetaTrackingEntityLevel, QuotaUsage>> = {},
): {
  ports: DailyMetricsPorts;
  asked: Asked[];
  upserted: DailyMetricRow[][];
} {
  const asked: Asked[] = [];
  const upserted: DailyMetricRow[][] = [];

  const ports: DailyMetricsPorts = {
    fetchInsights: async ({ entityLevel, range }) => {
      asked.push({ entityLevel, range });
      return {
        rows: [dayFor(entityLevel, range.until)],
        usage: usageByLevel[entityLevel] ?? UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      };
    },
    upsertRows: async (rows) => {
      upserted.push([...rows]);
      return rows.length;
    },
    ...overrides,
  };

  return { ports, asked, upserted };
}

describe("collectDailyMetrics", () => {
  test("os três níveis são consultados na janela móvel e viram linhas upsertadas", async () => {
    const { ports, asked, upserted } = makePorts();

    const result = await collectDailyMetrics(ports, ARGS);

    expect(asked).toEqual([
      { entityLevel: "campaign", range: WINDOW },
      { entityLevel: "adset", range: WINDOW },
      { entityLevel: "ad", range: WINDOW },
    ]);
    expect(result).toMatchObject({
      rowsUpserted: 3,
      apiCalls: 3,
      stoppedForQuota: false,
      slicesDegraded: 0,
      levelsAbandoned: [],
    });
    expect(upserted.flat().map((row) => row.entityId)).toEqual([
      FIXTURE_CAMPAIGN_ID,
      FIXTURE_ADSET_ID,
      FIXTURE_AD_ID,
    ]);
  });

  test("a série vem da CONTA, não das entidades ativas: a cauda de quem pausou entra igual", async () => {
    const pausedCampaignId = "120250000000000999";
    const { ports, upserted } = makePorts({
      fetchInsights: async ({ entityLevel, range }) => ({
        rows:
          entityLevel === "campaign"
            ? [
                insightsDayV25({
                  date_start: range.until,
                  date_stop: range.until,
                  campaign_id: pausedCampaignId,
                }),
              ]
            : [],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
    });

    const result = await collectDailyMetrics(ports, ARGS);

    // Nada aqui pergunta quais entidades estão entregando — é por isso que a
    // atribuição retroativa de quem foi pausado ontem continua sendo gravada.
    expect(upserted.flat().map((row) => row.entityId)).toEqual([
      pausedCampaignId,
    ]);
    expect(result.rowsUpserted).toBe(1);
  });

  test("erro de volume corta o período ao meio e a conta é completada assim mesmo", async () => {
    const { ports, asked, upserted } = makePorts({
      fetchInsights: async ({ entityLevel, range }) => {
        asked.push({ entityLevel, range });
        if (entityLevel === "ad" && range.since === WINDOW.since && range.until === WINDOW.until) {
          throw rowLimitError();
        }
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(asked.filter((call) => call.entityLevel === "ad").map((call) => call.range)).toEqual([
      WINDOW,
      { since: "2026-07-12", until: "2026-07-25" },
      { since: "2026-07-26", until: "2026-08-09" },
    ]);
    // As duas metades trouxeram dias diferentes: nenhuma linha se perdeu.
    expect(upserted.at(-1)?.map((row) => row.metricDate)).toEqual([
      "2026-07-25",
      "2026-08-09",
    ]);
    expect(result).toMatchObject({
      rowsUpserted: 4,
      slicesDegraded: 1,
      levelsAbandoned: [],
    });
  });

  test("volume que persiste até o dia único abandona o nível sem derrubar os outros", async () => {
    const { ports, upserted } = makePorts({
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "ad") throw rowLimitError();
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(result.levelsAbandoned).toEqual(["ad"]);
    expect(result.rowsUpserted).toBe(2);
    expect(upserted.flat().map((row) => row.entityLevel)).toEqual([
      "campaign",
      "adset",
    ]);
  });

  test("cota apertada interrompe antes do próximo nível e o que já veio é gravado", async () => {
    const { ports, asked, upserted } = makePorts(
      {},
      { campaign: { utilizationPercent: 92, estimatedRegainMs: null } },
    );

    const result = await collectDailyMetrics(ports, ARGS);

    expect(asked.map((call) => call.entityLevel)).toEqual(["campaign"]);
    expect(result).toMatchObject({ stoppedForQuota: true, rowsUpserted: 1 });
    expect(upserted.flat()).toHaveLength(1);
  });

  test("a cota já gasta pela etapa de configuração impede a coleta de métricas", async () => {
    const { ports, asked } = makePorts();

    const result = await collectDailyMetrics(ports, {
      ...ARGS,
      usage: { utilizationPercent: 85, estimatedRegainMs: null },
    });

    expect(asked).toEqual([]);
    expect(result).toMatchObject({ stoppedForQuota: true, rowsUpserted: 0 });
  });

  test("erro que não é de volume sobe, mas o que já foi gravado permanece", async () => {
    const { ports, upserted } = makePorts({
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "adset") throw new Error("token expirado");
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
    });

    await expect(collectDailyMetrics(ports, ARGS)).rejects.toThrow("token expirado");
    expect(upserted.flat().map((row) => row.entityLevel)).toEqual(["campaign"]);
  });

  test("nível sem entrega nenhuma não chama o upsert à toa", async () => {
    const { ports, upserted } = makePorts({
      fetchInsights: async () => ({
        rows: [],
        usage: UNKNOWN_QUOTA_USAGE,
        apiCalls: 1,
      }),
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(upserted).toEqual([]);
    expect(result.rowsUpserted).toBe(0);
  });
});

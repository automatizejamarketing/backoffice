import { describe, expect, test } from "bun:test";

import {
  collectDailyMetrics,
  type DailyMetricsPorts,
  type InsightsFetchStrategies,
} from "@/lib/meta-tracking/collect-daily-metrics";
import {
  metricsWindowFor,
  rangeDays,
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

/**
 * A OUTRA cara da recusa por custo: a consulta bateu no teto de ~30 s do
 * servidor. Chega como erro genérico, sem nada no texto sobre volume.
 */
function serverTimeoutError(): Error {
  const error = new Error("Service temporarily unavailable");
  Object.assign(error, {
    errorReturn: { statusCode: 400, data: { code: 2, errorSubcode: 1504044 } },
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

  test("falha ao carregar estratégia é fail-soft e usa a janela padrão", async () => {
    const { ports, asked } = makePorts({
      loadInsightsStrategies: async () => {
        throw new Error('relation "meta_tracking_insights_strategies" does not exist');
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(asked).toEqual([
      { entityLevel: "campaign", range: WINDOW },
      { entityLevel: "adset", range: WINDOW },
      { entityLevel: "ad", range: WINDOW },
    ]);
    expect(result).toMatchObject({
      rowsUpserted: 3,
      strategyLoadFailures: 1,
      strategySaveFailures: 0,
      levelsAbandoned: [],
    });
  });

  test("falha ao salvar estratégia acontece depois do upsert e perde só o aprendizado", async () => {
    let adsetRowsUpserted = false;
    const { ports } = makePorts({
      loadInsightsStrategies: async () => ({}),
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "adset" && rangeDays(range) > 15) {
          throw serverTimeoutError();
        }
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
      upsertRows: async (rows) => {
        if (rows.some((row) => row.entityLevel === "adset")) {
          adsetRowsUpserted = true;
        }
        return rows.length;
      },
      saveInsightsStrategy: async ({ entityLevel }) => {
        if (entityLevel === "adset") {
          expect(adsetRowsUpserted).toBe(true);
          throw new Error("strategy table unavailable");
        }
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(adsetRowsUpserted).toBe(true);
    expect(result).toMatchObject({
      rowsUpserted: 4,
      strategyLoadFailures: 0,
      strategySaveFailures: 1,
      levelsAbandoned: [],
    });
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

  test("um período explícito substitui a janela móvel — é assim que o backfill reusa o passo", async () => {
    const range = { since: "2025-09-01", until: "2025-09-30" };
    const { ports, asked, upserted } = makePorts();

    const result = await collectDailyMetrics(ports, { ...ARGS, range });

    expect(asked.map((call) => call.range)).toEqual([range, range, range]);
    // Dia fora da janela mutável nasce final: o backfill grava passado congelado.
    expect(upserted.flat().every((row) => row.isFinal)).toBe(true);
    expect(result.rowsUpserted).toBe(3);
  });

  test("conta que estoura o teto até no dia único vai inteira para o job assíncrono", async () => {
    const asyncCalls: InsightsRange[] = [];
    const { ports, upserted } = makePorts({
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "ad") throw rowLimitError();
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
      fetchInsightsAsync: async ({ entityLevel, range }) => {
        asyncCalls.push(range);
        return {
          rows: [dayFor(entityLevel, range.since), dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 5,
        };
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    // Um job só, pelo período INTEIRO: se nem um dia cabe no caminho síncrono,
    // continuar fatiando geraria 29 jobs para o mesmo resultado.
    expect(asyncCalls).toEqual([WINDOW]);
    expect(result.levelsAbandoned).toEqual([]);
    expect(upserted.at(-1)?.map((row) => row.metricDate)).toEqual([
      WINDOW.since,
      WINDOW.until,
    ]);
  });

  test("sem porta assíncrona, o dia único que estoura continua abandonando o nível", async () => {
    const { ports } = makePorts({
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
  });

  test("job assíncrono que também estoura o teto abandona o nível sem derrubar a conta", async () => {
    const { ports, upserted } = makePorts({
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "ad") throw rowLimitError();
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
      fetchInsightsAsync: async () => {
        throw rowLimitError();
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(result.levelsAbandoned).toEqual(["ad"]);
    expect(upserted.flat().map((row) => row.entityLevel)).toEqual([
      "campaign",
      "adset",
    ]);
  });

  test("estouro de tempo do servidor entra na escada igual ao teto de linhas", async () => {
    // Este é o caso da conta grande: 28 dias morrem aos 30 s, as fatias passam.
    // Sem isto o nível inteiro ficava sem série, e era o que acontecia todo dia.
    const janelaInteira = `${WINDOW.since}..${WINDOW.until}`;
    const pedidosDeAdset: string[] = [];
    const { ports, upserted } = makePorts({
      fetchInsights: async ({ entityLevel, range }) => {
        const periodo = `${range.since}..${range.until}`;
        if (entityLevel === "adset") {
          pedidosDeAdset.push(periodo);
          if (periodo === janelaInteira) throw serverTimeoutError();
        }
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(result.levelsAbandoned).toEqual([]);
    expect(result.slicesDegraded).toBe(1);
    // A janela inteira, e depois as duas metades — que entregaram.
    expect(pedidosDeAdset).toHaveLength(3);
    expect(pedidosDeAdset[0]).toBe(janelaInteira);
    // As metades cobrem o período sem buraco nem sobreposição.
    expect(pedidosDeAdset[1].startsWith(WINDOW.since)).toBe(true);
    expect(pedidosDeAdset[2].endsWith(WINDOW.until)).toBe(true);
    expect(upserted.flat().some((row) => row.entityLevel === "adset")).toBe(true);
  });

  test("conta recorrente grande reutiliza a janela segura sem repetir a consulta excessiva", async () => {
    let run = 0;
    let learned: InsightsFetchStrategies = {};
    const adsetCalls: InsightsRange[][] = [[], []];
    const { ports } = makePorts({
      loadInsightsStrategies: async () => ({ ...learned }),
      saveInsightsStrategy: async ({ entityLevel, strategy }) => {
        learned = { ...learned, [entityLevel]: strategy };
      },
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "adset") {
          adsetCalls[run].push(range);
          if (rangeDays(range) > 15) throw serverTimeoutError();
        }
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
    });

    const first = await collectDailyMetrics(ports, ARGS);
    run = 1;
    const second = await collectDailyMetrics(ports, ARGS);

    expect(first.levelsAbandoned).toEqual([]);
    expect(adsetCalls[0]).toEqual([
      WINDOW,
      { since: "2026-07-12", until: "2026-07-25" },
      { since: "2026-07-26", until: "2026-08-09" },
    ]);
    expect(learned.adset).toEqual({ mode: "sync", maxRangeDays: 14 });
    expect(adsetCalls[1]).toEqual([
      { since: "2026-07-12", until: "2026-07-25" },
      { since: "2026-07-26", until: "2026-08-08" },
      { since: "2026-08-09", until: "2026-08-09" },
    ]);
    expect(
      adsetCalls[1].some(
        (range) =>
          range.since === WINDOW.since && range.until === WINDOW.until,
      ),
    ).toBe(false);
    // O recuo conhecido continua aparecendo como degradação tratada, mesmo
    // sem provocar outro erro da Meta.
    expect(second.slicesDegraded).toBe(1);
  });

  test("a janela aprendida ainda recua quando o volume volta a crescer", async () => {
    let learned: InsightsFetchStrategies = {
      adset: { mode: "sync", maxRangeDays: 14 },
    };
    const adsetCalls: InsightsRange[] = [];
    const { ports, upserted } = makePorts({
      loadInsightsStrategies: async () => ({ ...learned }),
      saveInsightsStrategy: async ({ entityLevel, strategy }) => {
        learned = { ...learned, [entityLevel]: strategy };
      },
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "adset") {
          adsetCalls.push(range);
          if (rangeDays(range) > 7) throw rowLimitError();
        }
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(adsetCalls).toEqual([
      { since: "2026-07-12", until: "2026-07-25" },
      { since: "2026-07-12", until: "2026-07-18" },
      { since: "2026-07-19", until: "2026-07-25" },
      { since: "2026-07-26", until: "2026-08-08" },
      { since: "2026-07-26", until: "2026-08-01" },
      { since: "2026-08-02", until: "2026-08-08" },
      { since: "2026-08-09", until: "2026-08-09" },
    ]);
    expect(learned.adset).toEqual({ mode: "sync", maxRangeDays: 7 });
    expect(result.levelsAbandoned).toEqual([]);
    expect(result.slicesDegraded).toBe(3);
    expect(upserted.flat().some((row) => row.entityLevel === "adset")).toBe(true);
  });

  test("modo assíncrono só é aprendido pelo range completo e é reaplicado igual", async () => {
    let learned: InsightsFetchStrategies = {};
    const syncAdCalls: InsightsRange[] = [];
    const asyncAdCalls: InsightsRange[] = [];
    const { ports } = makePorts({
      loadInsightsStrategies: async () => ({ ...learned }),
      saveInsightsStrategy: async ({ entityLevel, strategy }) => {
        learned = { ...learned, [entityLevel]: strategy };
      },
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "ad") {
          syncAdCalls.push(range);
          throw rowLimitError();
        }
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
      fetchInsightsAsync: async ({ entityLevel, range }) => {
        if (entityLevel === "ad") asyncAdCalls.push(range);
        return {
          rows: [dayFor(entityLevel, range.since), dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 3,
        };
      },
    });

    const first = await collectDailyMetrics(ports, ARGS);
    const syncCallsAfterLearning = syncAdCalls.length;
    const second = await collectDailyMetrics(ports, ARGS);

    // O dia único apenas dispara o último degrau. O job que valida `async` e a
    // reaplicação seguinte recebem ambos o alvo diário INTEIRO.
    expect(asyncAdCalls).toEqual([WINDOW, WINDOW]);
    expect(learned.ad).toEqual({ mode: "async" });
    expect(syncCallsAfterLearning).toBe(5);
    expect(syncAdCalls).toHaveLength(syncCallsAfterLearning);
    expect(first.levelsAbandoned).toEqual([]);
    expect(second.slicesDegraded).toBe(1);
    expect(second.levelsAbandoned).toEqual([]);
  });

  test("falha final do modo assíncrono aprendido continua estruturada", async () => {
    const { ports } = makePorts({
      loadInsightsStrategies: async () => ({
        ad: { mode: "async" },
      }),
      saveInsightsStrategy: async () => {},
      fetchInsightsAsync: async () => {
        throw rowLimitError();
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(result.levelsAbandoned).toEqual(["ad"]);
  });

  test("nível que falha do começo ao fim desce UMA vez, não uma árvore de fatias", async () => {
    // O portão do recuo reconhece erros genéricos da Meta (`2/1504044`), então
    // uma instabilidade de verdade também entra na escada. O que impede isso de
    // virar avalanche é o `break`: a fatia da frente é sempre a próxima
    // tentada, então a descida é uma só. Importa porque a licença Meta do app é
    // throttled por TAXA DE ERRO — multiplicar chamadas condenadas é o pior
    // resultado possível.
    let adsetCalls = 0;
    const { ports } = makePorts({
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "adset") {
          adsetCalls += 1;
          throw serverTimeoutError();
        }
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
      fetchInsightsAsync: async () => {
        throw rowLimitError();
      },
    });

    const result = await collectDailyMetrics(ports, ARGS);

    expect(result.levelsAbandoned).toEqual(["adset"]);
    // Uma descida por metades numa janela de 29 dias: 29 → 14 → 7 → 3 → 1.
    // Uma árvore completa passaria de trinta chamadas.
    expect(adsetCalls).toBe(5);
    // E os outros níveis não são punidos pelo que aconteceu neste.
    expect(result.rowsUpserted).toBeGreaterThan(0);
  });

  test("falha do job assíncrono que não é de volume sobe — o operador precisa vê-la", async () => {
    const { ports } = makePorts({
      fetchInsights: async ({ entityLevel, range }) => {
        if (entityLevel === "ad") throw rowLimitError();
        return {
          rows: [dayFor(entityLevel, range.until)],
          usage: UNKNOWN_QUOTA_USAGE,
          apiCalls: 1,
        };
      },
      fetchInsightsAsync: async () => {
        throw new Error("Job assíncrono de insights não completou");
      },
    });

    await expect(collectDailyMetrics(ports, ARGS)).rejects.toThrow(
      "Job assíncrono de insights não completou",
    );
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

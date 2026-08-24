import { describe, expect, test } from "bun:test";

import {
  METRICS_MUTABLE_DAYS,
  isFinalMetricDay,
  isInsightsTooHeavyError,
  metricsWindowFor,
  partitionInsightsRange,
  rangeDays,
  splitInsightsRange,
  toDailyMetricRows,
} from "@/lib/meta-tracking/daily-metrics";
import {
  FIXTURE_ACCOUNT_ID,
  FIXTURE_AD_ID,
  FIXTURE_ADSET_ID,
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_USER_ID,
  insightsDayV25,
} from "@/lib/meta-tracking/fixtures/graph-api-v25";

const TODAY = "2026-08-09";

const OWNER = { userId: FIXTURE_USER_ID, accountId: FIXTURE_ACCOUNT_ID };

describe("metricsWindowFor", () => {
  test("a janela cobre todos os dias em que a atribuição ainda pode mudar", () => {
    expect(metricsWindowFor(TODAY)).toEqual({
      since: "2026-07-12",
      until: "2026-08-09",
    });
  });

  test("a janela atravessa a virada do mês e do ano", () => {
    expect(metricsWindowFor("2027-01-05")).toEqual({
      since: "2026-12-08",
      until: "2027-01-05",
    });
  });
});

describe("isFinalMetricDay", () => {
  test("o dia de hoje ainda muda", () => {
    expect(isFinalMetricDay(TODAY, TODAY)).toBe(false);
  });

  test("o dia da borda da janela é a ÚLTIMA re-coleta dele: já nasce final", () => {
    const edge = metricsWindowFor(TODAY).since;
    expect(edge).toBe("2026-07-12");
    expect(isFinalMetricDay(edge, TODAY)).toBe(true);
  });

  test("o dia seguinte à borda ainda é mutável", () => {
    expect(isFinalMetricDay("2026-07-13", TODAY)).toBe(false);
  });

  test("dia fora da janela é final", () => {
    expect(isFinalMetricDay("2026-01-30", TODAY)).toBe(true);
  });

  test("a janela de mutabilidade documentada pela Meta é de 28 dias", () => {
    expect(METRICS_MUTABLE_DAYS).toBe(28);
  });
});

describe("toDailyMetricRows", () => {
  test("um dia de campanha vira uma linha com numéricos tipados e famílias cruas", () => {
    const [row] = toDailyMetricRows({
      ...OWNER,
      entityLevel: "campaign",
      today: TODAY,
      rows: [insightsDayV25()],
    });

    expect(row).toMatchObject({
      userId: FIXTURE_USER_ID,
      accountId: FIXTURE_ACCOUNT_ID,
      entityLevel: "campaign",
      entityId: FIXTURE_CAMPAIGN_ID,
      // Campanha não desnormaliza a si mesma — igual à tabela de versões.
      campaignId: null,
      adsetId: null,
      metricDate: "2026-08-08",
      // Unidades MAIORES da moeda, exatamente como a Meta entregou.
      spend: "128.47",
      impressions: 9432,
      clicks: 212,
      reach: 7781,
      frequency: "1.212183",
      isFinal: false,
    });
    expect(row.actions).toEqual([
      { action_type: "link_click", value: "212" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "7" },
      { action_type: "omni_purchase", value: "7" },
    ]);
    expect(row.purchaseRoas).toEqual([
      { action_type: "omni_purchase", value: "10.856231" },
    ]);
    expect(row.costPerResult).toEqual([
      {
        indicator: "actions:offsite_conversion.fb_pixel_purchase",
        values: [{ value: "18.352857", attribution_windows: ["default"] }],
      },
    ]);
  });

  test("as métricas conhecidas já saem promovidas a coluna, na escrita", () => {
    const [row] = toDailyMetricRows({
      ...OWNER,
      entityLevel: "campaign",
      today: TODAY,
      rows: [
        insightsDayV25({
          video_thruplay_watched_actions: [
            { action_type: "video_view", value: "1410" },
          ],
          estimated_ad_recallers: "3120",
        }),
      ],
    });

    // O detalhe de CADA coluna é de `metric-columns.test.ts`; aqui o que
    // importa é que a linha gravada já venha com elas.
    expect(row).toMatchObject({
      linkClicks: 212,
      purchases: 7,
      purchaseValue: "1394.70",
      results: 7,
      thruplays: 1410,
      estimatedAdRecallers: 3120,
      // Objetivo de vendas não reporta lead: NULL, não zero.
      leads: null,
    });
    // A família de vídeo continua crua no reservatório, ao lado da coluna.
    expect(row.videoActions).toEqual({
      video_thruplay_watched_actions: [
        { action_type: "video_view", value: "1410" },
      ],
    });
  });

  test("conjunto e anúncio desnormalizam a hierarquia acima deles", () => {
    const [adset] = toDailyMetricRows({
      ...OWNER,
      entityLevel: "adset",
      today: TODAY,
      rows: [insightsDayV25({ adset_id: FIXTURE_ADSET_ID })],
    });
    const [ad] = toDailyMetricRows({
      ...OWNER,
      entityLevel: "ad",
      today: TODAY,
      rows: [
        insightsDayV25({ adset_id: FIXTURE_ADSET_ID, ad_id: FIXTURE_AD_ID }),
      ],
    });

    expect(adset).toMatchObject({
      entityId: FIXTURE_ADSET_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      adsetId: null,
    });
    expect(ad).toMatchObject({
      entityId: FIXTURE_AD_ID,
      campaignId: FIXTURE_CAMPAIGN_ID,
      adsetId: FIXTURE_ADSET_ID,
    });
  });

  test("métrica ausente vira nulo em vez de zero — zero é um resultado, ausência não", () => {
    const [row] = toDailyMetricRows({
      ...OWNER,
      entityLevel: "campaign",
      today: TODAY,
      rows: [
        insightsDayV25({
          reach: undefined,
          frequency: undefined,
          purchase_roas: undefined,
          spend: "0",
          clicks: "0",
        }),
      ],
    });

    expect(row).toMatchObject({
      spend: "0",
      clicks: 0,
      reach: null,
      frequency: null,
    });
    expect(row.purchaseRoas).toBeNull();
  });

  test("o dia que está saindo da janela nasce final", () => {
    const [row] = toDailyMetricRows({
      ...OWNER,
      entityLevel: "campaign",
      today: TODAY,
      rows: [insightsDayV25({ date_start: "2026-07-12" })],
    });

    expect(row).toMatchObject({ metricDate: "2026-07-12", isFinal: true });
  });

  test("linha sem o id da entidade daquele nível é descartada, não inventada", () => {
    const rows = toDailyMetricRows({
      ...OWNER,
      entityLevel: "adset",
      today: TODAY,
      rows: [insightsDayV25(), insightsDayV25({ adset_id: FIXTURE_ADSET_ID })],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe(FIXTURE_ADSET_ID);
  });

  test("linha sem dia utilizável é descartada", () => {
    const rows = toDailyMetricRows({
      ...OWNER,
      entityLevel: "campaign",
      today: TODAY,
      rows: [
        insightsDayV25({ date_start: undefined }),
        insightsDayV25({ date_start: "ontem" }),
      ],
    });

    expect(rows).toEqual([]);
  });

  test("o mesmo dia repetido na resposta vira uma linha só — o upsert não sobrevive a duplicata", () => {
    const rows = toDailyMetricRows({
      ...OWNER,
      entityLevel: "campaign",
      today: TODAY,
      rows: [insightsDayV25({ spend: "1.00" }), insightsDayV25({ spend: "2.00" })],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe("2.00");
  });
});

describe("splitInsightsRange", () => {
  test("a janela inteira é partida em duas metades que cobrem tudo sem sobrepor", () => {
    const window = metricsWindowFor(TODAY);

    const halves = splitInsightsRange(window);

    expect(halves).toEqual([
      { since: "2026-07-12", until: "2026-07-25" },
      { since: "2026-07-26", until: "2026-08-09" },
    ]);
    expect(rangeDays(halves[0]) + rangeDays(halves[1])).toBe(rangeDays(window));
  });

  test("dois dias viram um dia cada", () => {
    expect(splitInsightsRange({ since: "2026-08-08", until: "2026-08-09" })).toEqual([
      { since: "2026-08-08", until: "2026-08-08" },
      { since: "2026-08-09", until: "2026-08-09" },
    ]);
  });

  test("um dia só não tem como encolher — quem chamou precisa saber disso", () => {
    expect(splitInsightsRange({ since: TODAY, until: TODAY })).toEqual([]);
  });

  test("período invertido não vira fatia nenhuma", () => {
    expect(
      splitInsightsRange({ since: "2026-08-09", until: "2026-08-01" }),
    ).toEqual([]);
  });
});

describe("partitionInsightsRange", () => {
  test("a janela aprendida cobre o alvo inteiro sem buraco nem sobreposição", () => {
    const window = metricsWindowFor(TODAY);

    const slices = partitionInsightsRange(window, 14);

    expect(slices).toEqual([
      { since: "2026-07-12", until: "2026-07-25" },
      { since: "2026-07-26", until: "2026-08-08" },
      { since: "2026-08-09", until: "2026-08-09" },
    ]);
    expect(slices.reduce((total, slice) => total + rangeDays(slice), 0)).toBe(
      rangeDays(window),
    );
  });

  test("limite inválido é recusado em vez de produzir período incorreto", () => {
    expect(() => partitionInsightsRange(metricsWindowFor(TODAY), 0)).toThrow(
      "maxRangeDays",
    );
  });
});

describe("isInsightsTooHeavyError", () => {
  function graphError(code: number, errorSubcode?: number): unknown {
    return {
      name: "GraphApiError",
      errorReturn: { statusCode: 400, data: { code, errorSubcode } },
    };
  }

  test("erro de volume de linhas é reconhecido pelo subcódigo", () => {
    expect(isInsightsTooHeavyError(graphError(100, 1487534))).toBe(true);
  });

  test("estouro de tempo do servidor também é recusa por custo", () => {
    // As duas formas medidas contra a v25 numa conta de 657 conjuntos: a mesma
    // janela responde em 7 dias e morre aos 30 s em 14. Sem reconhecê-las, a
    // escada de recuo nunca engata e o nível fica sem série todo dia.
    expect(isInsightsTooHeavyError(graphError(2, 1504044))).toBe(true);
    expect(isInsightsTooHeavyError(graphError(1, 99))).toBe(true);
  });

  test("o subcódigo é que decide — o código sozinho não basta", () => {
    expect(isInsightsTooHeavyError(graphError(100))).toBe(false);
    expect(isInsightsTooHeavyError(graphError(100, 1487742))).toBe(false);
    expect(isInsightsTooHeavyError(graphError(2))).toBe(false);
    expect(isInsightsTooHeavyError(graphError(1))).toBe(false);
    // Par trocado não casa: o subcódigo pertence ao seu código.
    expect(isInsightsTooHeavyError(graphError(2, 99))).toBe(false);
    expect(isInsightsTooHeavyError(graphError(1, 1504044))).toBe(false);
  });

  test("erro que não é da Graph API não é recusa por custo", () => {
    expect(isInsightsTooHeavyError(new Error("timeout"))).toBe(false);
    expect(isInsightsTooHeavyError(null)).toBe(false);
    expect(isInsightsTooHeavyError({ errorReturn: {} })).toBe(false);
  });
});

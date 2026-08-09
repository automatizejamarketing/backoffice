import { describe, expect, test } from "bun:test";

import {
  VIDEO_INSIGHT_FIELDS,
  extractMetricColumns,
  metricColumnSourceFromInsightsRow,
  planMetricColumnPromotion,
} from "@/lib/meta-tracking/metric-columns";
import { insightsDayV25 } from "@/lib/meta-tracking/fixtures/graph-api-v25";

/** A extração como a escrita a faz: linha crua da Meta ⇒ colunas. */
function columnsOf(raw: Record<string, unknown>) {
  return extractMetricColumns(metricColumnSourceFromInsightsRow(raw));
}

/** Só as chaves preenchidas — o que o dia REPORTOU, sem o ruído dos nulos. */
function reported(columns: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(columns).filter(([, value]) => value !== null),
  );
}

describe("metricColumnSourceFromInsightsRow", () => {
  test("as famílias de vídeo viram um reservatório único, cru como veio", () => {
    const source = metricColumnSourceFromInsightsRow(
      insightsDayV25({
        video_thruplay_watched_actions: [
          { action_type: "video_view", value: "410" },
        ],
        video_p95_watched_actions: [{ action_type: "video_view", value: "180" }],
      }),
    );

    expect(source.videoActions).toEqual({
      video_thruplay_watched_actions: [
        { action_type: "video_view", value: "410" },
      ],
      video_p95_watched_actions: [{ action_type: "video_view", value: "180" }],
    });
  });

  test("dia sem nenhum campo de vídeo não inventa reservatório vazio", () => {
    expect(metricColumnSourceFromInsightsRow(insightsDayV25()).videoActions).toBe(
      null,
    );
  });
});

describe("extractMetricColumns — objetivo de vendas", () => {
  const columns = columnsOf(insightsDayV25());

  test("compra não é contada duas vezes quando vêm purchase e omni_purchase", () => {
    // A fixture reporta `offsite_conversion.fb_pixel_purchase: 7` E
    // `omni_purchase: 7` — o mesmo fato. Somar daria 14.
    expect(columns.purchases).toBe(7);
    expect(columns.purchaseValue).toBe("1394.70");
  });

  test("ROAS e custo por resultado são numeric, na precisão que a Meta mandou", () => {
    expect(columns.purchaseRoasValue).toBe("10.856231");
    expect(columns.costPerResultValue).toBe("18.352857");
  });

  test("results sai do indicator do cost_per_result, contado em actions", () => {
    // indicator = "actions:offsite_conversion.fb_pixel_purchase" ⇒ 7 compras.
    expect(columns.results).toBe(7);
  });

  test("cliques no link saem da família de ações, não de `clicks`", () => {
    expect(columns.linkClicks).toBe(212);
  });

  test("o que a Meta não reportou fica NULL — nunca zero", () => {
    expect(reported(columns)).toEqual({
      linkClicks: 212,
      purchases: 7,
      purchaseValue: "1394.70",
      purchaseRoasValue: "10.856231",
      results: 7,
      costPerResultValue: "18.352857",
    });
  });
});

describe("extractMetricColumns — objetivo de mensagens (WhatsApp)", () => {
  const columns = columnsOf(
    insightsDayV25({
      actions: [
        { action_type: "link_click", value: "310" },
        {
          action_type: "onsite_conversion.messaging_conversation_started_7d",
          value: "48",
        },
        { action_type: "onsite_conversion.messaging_first_reply", value: "31" },
        { action_type: "onsite_conversion.total_messaging_connection", value: "60" },
      ],
      action_values: undefined,
      purchase_roas: undefined,
      website_purchase_roas: undefined,
      cost_per_result: [
        {
          indicator:
            "actions:onsite_conversion.messaging_conversation_started_7d",
          values: [{ value: "2.676458" }],
        },
      ],
    }),
  );

  test("conversas iniciadas e primeiras respostas viram colunas", () => {
    expect(columns.messagingConversationsStarted).toBe(48);
    expect(columns.messagingFirstReplies).toBe(31);
  });

  test("results acompanha o objetivo da conta, não a compra", () => {
    expect(columns.results).toBe(48);
    expect(columns.costPerResultValue).toBe("2.676458");
  });

  test("sem compra no dia, as colunas de comércio ficam NULL", () => {
    expect(columns.purchases).toBe(null);
    expect(columns.purchaseValue).toBe(null);
    expect(columns.purchaseRoasValue).toBe(null);
  });
});

describe("extractMetricColumns — objetivo de engajamento", () => {
  const columns = columnsOf(
    insightsDayV25({
      actions: [
        { action_type: "post_engagement", value: "1204" },
        { action_type: "page_engagement", value: "1310" },
        { action_type: "post_reaction", value: "820" },
        { action_type: "comment", value: "97" },
        { action_type: "post", value: "44" },
        { action_type: "onsite_conversion.post_save", value: "18" },
        { action_type: "like", value: "63" },
      ],
      action_values: undefined,
      purchase_roas: undefined,
      website_purchase_roas: undefined,
      cost_per_result: undefined,
    }),
  );

  test("as sete formas de engajamento têm coluna própria", () => {
    expect(reported(columns)).toEqual({
      postEngagements: 1204,
      pageEngagements: 1310,
      postReactions: 820,
      comments: 97,
      shares: 44,
      postSaves: 18,
      pageLikes: 63,
    });
  });
});

describe("extractMetricColumns — objetivo de vídeo", () => {
  const columns = columnsOf(
    insightsDayV25({
      actions: [
        { action_type: "video_view", value: "5120" },
        { action_type: "post_engagement", value: "5400" },
      ],
      action_values: undefined,
      purchase_roas: undefined,
      website_purchase_roas: undefined,
      cost_per_result: [
        { indicator: "actions:video_view", values: [{ value: "0.025091" }] },
      ],
      video_thruplay_watched_actions: [
        { action_type: "video_view", value: "1410" },
      ],
      video_p25_watched_actions: [{ action_type: "video_view", value: "3900" }],
      video_p50_watched_actions: [{ action_type: "video_view", value: "2600" }],
      video_p75_watched_actions: [{ action_type: "video_view", value: "1800" }],
      video_p95_watched_actions: [{ action_type: "video_view", value: "1210" }],
      video_p100_watched_actions: [{ action_type: "video_view", value: "1100" }],
      video_avg_time_watched_actions: [
        { action_type: "video_view", value: "7.42" },
      ],
      estimated_ad_recallers: "3120",
    }),
  );

  test("o funil de vídeo inteiro vira colunas tipadas", () => {
    expect(columns.videoViews3s).toBe(5120);
    expect(columns.thruplays).toBe(1410);
    expect(columns.videoWatchesP25).toBe(3900);
    expect(columns.videoWatchesP50).toBe(2600);
    expect(columns.videoWatchesP75).toBe(1800);
    expect(columns.videoWatchesP95).toBe(1210);
    expect(columns.videoWatchesP100).toBe(1100);
  });

  test("tempo médio assistido é numeric em segundos", () => {
    expect(columns.videoAvgWatchSeconds).toBe("7.42");
  });

  test("lembrança de anúncio é escalar, não família", () => {
    expect(columns.estimatedAdRecallers).toBe(3120);
  });

  test("campo pedido sem coluna fica só no reservatório — o contrato em ação", () => {
    const source = metricColumnSourceFromInsightsRow(
      insightsDayV25({
        video_play_actions: [{ action_type: "video_view", value: "9900" }],
      }),
    );

    // `video_play_actions` não tem coluna hoje. Capturá-lo mesmo assim é o que
    // permite promovê-lo amanhã sobre o histórico de ontem.
    expect(source.videoActions).toEqual({
      video_play_actions: [{ action_type: "video_view", value: "9900" }],
    });
    expect(VIDEO_INSIGHT_FIELDS).toContain("video_play_actions");
  });
});

describe("extractMetricColumns — objetivo de alcance", () => {
  test("dia sem nenhuma ação reportada devolve todas as colunas NULL", () => {
    const columns = columnsOf(
      insightsDayV25({
        actions: undefined,
        action_values: undefined,
        cost_per_action_type: undefined,
        cost_per_result: undefined,
        purchase_roas: undefined,
        website_purchase_roas: undefined,
      }),
    );

    expect(reported(columns)).toEqual({});
  });
});

describe("results", () => {
  test("indicator que não aponta para uma ação cai na divisão gasto ÷ custo", () => {
    // Objetivo de alcance: o resultado é gente alcançada, e não há action_type
    // que o conte. `spend / cost_per_result` devolve o mesmo número.
    const columns = columnsOf(
      insightsDayV25({
        spend: "128.47",
        actions: undefined,
        cost_per_result: [
          { indicator: "reach", values: [{ value: "0.0212" }] },
        ],
      }),
    );

    expect(columns.results).toBe(6060);
  });

  test("indicator de ação ausente da família também cai na divisão", () => {
    const columns = columnsOf(
      insightsDayV25({
        spend: "100.00",
        actions: [{ action_type: "link_click", value: "50" }],
        cost_per_result: [
          {
            indicator: "actions:offsite_conversion.fb_pixel_lead",
            values: [{ value: "5.00" }],
          },
        ],
      }),
    );

    expect(columns.results).toBe(20);
  });

  test("sem cost_per_result não há como derivar: NULL, nunca zero", () => {
    const columns = columnsOf(insightsDayV25({ cost_per_result: undefined }));

    expect(columns.results).toBe(null);
    expect(columns.costPerResultValue).toBe(null);
  });

  test("custo por resultado zerado não vira divisão por zero", () => {
    const columns = columnsOf(
      insightsDayV25({
        actions: undefined,
        cost_per_result: [{ indicator: "reach", values: [{ value: "0" }] }],
      }),
    );

    expect(columns.results).toBe(null);
    expect(columns.costPerResultValue).toBe("0");
  });

  test("a forma plana de cost_per_result (action_type + value) também é lida", () => {
    const columns = columnsOf(
      insightsDayV25({
        cost_per_result: [
          { action_type: "omni_purchase", value: "18.352857" },
        ],
      }),
    );

    expect(columns.costPerResultValue).toBe("18.352857");
    expect(columns.results).toBe(7);
  });
});

describe("valor de compra sem action_values", () => {
  test("é reconstruído por ROAS × gasto — a conta reporta ROAS mesmo assim", () => {
    const columns = columnsOf(
      insightsDayV25({
        spend: "50.00",
        action_values: undefined,
        purchase_roas: [{ action_type: "omni_purchase", value: "3" }],
      }),
    );

    expect(columns.purchaseValue).toBe("150");
    expect(columns.purchaseRoasValue).toBe("3");
  });

  test("website_purchase_roas entra quando purchase_roas não vem", () => {
    const columns = columnsOf(
      insightsDayV25({
        spend: "50.00",
        action_values: undefined,
        purchase_roas: undefined,
        website_purchase_roas: [
          { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
        ],
      }),
    );

    expect(columns.purchaseValue).toBe("100");
    expect(columns.purchaseRoasValue).toBe("2");
  });

  test("sem gasto não há reconstrução possível: fica NULL", () => {
    const columns = columnsOf(
      insightsDayV25({
        spend: "0",
        action_values: undefined,
        purchase_roas: [{ action_type: "omni_purchase", value: "3" }],
      }),
    );

    expect(columns.purchaseValue).toBe(null);
  });
});

describe("extração idempotente (o backfill reusa a MESMA função)", () => {
  test("re-extrair a partir da linha já gravada devolve as mesmas colunas", () => {
    const raw = insightsDayV25({
      video_thruplay_watched_actions: [
        { action_type: "video_view", value: "1410" },
      ],
      video_avg_time_watched_actions: [
        { action_type: "video_view", value: "7.42" },
      ],
      estimated_ad_recallers: "3120",
    });
    const written = extractMetricColumns(metricColumnSourceFromInsightsRow(raw));

    // A linha como o Postgres a devolve: famílias cruas no jsonb, vídeo no
    // reservatório e a lembrança de anúncio na própria coluna.
    const stored = {
      spend: "128.47",
      actions: raw.actions,
      actionValues: raw.action_values,
      costPerResult: raw.cost_per_result,
      purchaseRoas: raw.purchase_roas,
      websitePurchaseRoas: raw.website_purchase_roas,
      videoActions: {
        video_thruplay_watched_actions: [
          { action_type: "video_view", value: "1410" },
        ],
        video_avg_time_watched_actions: [
          { action_type: "video_view", value: "7.42" },
        ],
      },
      estimatedAdRecallers: written.estimatedAdRecallers,
    };

    expect(extractMetricColumns(stored)).toEqual(written);
  });

  test("linha antiga (sem reservatório de vídeo) mantém vídeo e recall NULL", () => {
    const columns = extractMetricColumns({
      spend: "128.47",
      actions: [{ action_type: "link_click", value: "212" }],
    });

    expect(columns.thruplays).toBe(null);
    expect(columns.videoAvgWatchSeconds).toBe(null);
    expect(columns.estimatedAdRecallers).toBe(null);
    expect(columns.linkClicks).toBe(212);
  });
});

describe("planMetricColumnPromotion (o lote do backfill retroativo)", () => {
  const linhas = [
    { id: "aaa", actions: [{ action_type: "link_click", value: "10" }] },
    { id: "bbb", actions: [{ action_type: "link_click", value: "20" }] },
  ];

  test("cada linha vira um UPDATE com as colunas extraídas", () => {
    const { updates } = planMetricColumnPromotion(linhas);

    expect(updates.map((update) => update.id)).toEqual(["aaa", "bbb"]);
    expect(updates[0].columns.linkClicks).toBe(10);
    expect(updates[1].columns.linkClicks).toBe(20);
  });

  test("o cursor é o id da última linha — é dele que a retomada parte", () => {
    expect(planMetricColumnPromotion(linhas).nextCursor).toBe("bbb");
  });

  test("lote vazio encerra a varredura: nada a atualizar, nenhum cursor", () => {
    expect(planMetricColumnPromotion([])).toEqual({
      updates: [],
      nextCursor: null,
    });
  });

  test("nenhuma linha é pulada — coluna nula é resposta, não pendência", () => {
    // Um dia de alcance puro não tem nada a promover, e ainda assim precisa
    // passar pelo lote: filtrá-lo faria a varredura reprocessá-lo para sempre.
    const { updates } = planMetricColumnPromotion([{ id: "ccc", spend: "10" }]);

    expect(updates).toHaveLength(1);
    expect(updates[0].columns.linkClicks).toBe(null);
  });
});

describe("contagem fracionária", () => {
  test("atribuição fracionária é arredondada, não truncada", () => {
    // A Meta divide um evento entre janelas de atribuição e devolve "6.9998".
    const columns = columnsOf(
      insightsDayV25({
        actions: [{ action_type: "omni_purchase", value: "6.9998" }],
      }),
    );

    expect(columns.purchases).toBe(7);
  });
});

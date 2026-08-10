import { describe, expect, test } from "bun:test";

import {
  buildEntityTimeline,
  computeActionEffect,
  selectVersionAt,
} from "./correlation";

/** Versão mínima: só o que a regra de vigência precisa enxergar. */
function version(args: {
  id: string;
  versionNumber: number;
  validFrom: string;
  validTo?: string | null;
}) {
  return {
    id: args.id,
    versionNumber: args.versionNumber,
    validFrom: new Date(args.validFrom),
    validTo: args.validTo ? new Date(args.validTo) : null,
  };
}

/**
 * Campanha com três versões: nasce em 01/03, muda em 10/03 às 14h, muda de novo
 * em 20/03 e segue vigente.
 */
const versions = [
  version({
    id: "v1",
    versionNumber: 1,
    validFrom: "2026-03-01T09:00:00.000Z",
    validTo: "2026-03-10T14:00:00.000Z",
  }),
  version({
    id: "v2",
    versionNumber: 2,
    validFrom: "2026-03-10T14:00:00.000Z",
    validTo: "2026-03-20T08:00:00.000Z",
  }),
  version({
    id: "v3",
    versionNumber: 3,
    validFrom: "2026-03-20T08:00:00.000Z",
    validTo: null,
  }),
];

describe("selectVersionAt", () => {
  test("instante entre duas versões devolve a que estava aberta", () => {
    expect(selectVersionAt(versions, new Date("2026-03-05T00:00:00.000Z"))?.id)
      .toBe("v1");
  });

  test("no instante exato da mudança já vale a versão nova", () => {
    expect(selectVersionAt(versions, new Date("2026-03-10T14:00:00.000Z"))?.id)
      .toBe("v2");
    expect(selectVersionAt(versions, new Date("2026-03-10T13:59:59.999Z"))?.id)
      .toBe("v1");
  });

  test("antes da primeira versão não há estado registrado", () => {
    expect(
      selectVersionAt(versions, new Date("2026-02-28T23:59:59.999Z")),
    ).toBeNull();
  });

  test("depois da última versão aberta ela continua vigente", () => {
    expect(selectVersionAt(versions, new Date("2027-01-01T00:00:00.000Z"))?.id)
      .toBe("v3");
  });

  test("depois da última versão fechada não há estado vigente", () => {
    const encerradas = versions.slice(0, 2);
    expect(
      selectVersionAt(encerradas, new Date("2026-03-25T00:00:00.000Z")),
    ).toBeNull();
  });

  test("uma data de calendário resolve o estado do fim daquele dia", () => {
    // O dia da mudança pertence à configuração com que o dia terminou.
    expect(selectVersionAt(versions, "2026-03-10")?.id).toBe("v2");
    expect(selectVersionAt(versions, "2026-03-09")?.id).toBe("v1");
  });

  test("ordem de entrada não importa", () => {
    const embaralhadas = [versions[2], versions[0], versions[1]];
    expect(
      selectVersionAt(embaralhadas, new Date("2026-03-05T00:00:00.000Z"))?.id,
    ).toBe("v1");
  });

  test("sem versões, não há estado", () => {
    expect(selectVersionAt([], new Date("2026-03-05T00:00:00.000Z"))).toBeNull();
  });
});

/**
 * Um dia da série, como o banco o devolve: `numeric` vira string, `integer`
 * vira number. Compras e valor são COLUNAS — a extração já resolveu a
 * prioridade entre `purchase` e `omni_purchase` na escrita.
 */
function day(args: {
  date: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
  purchases?: number;
  purchaseValue?: number;
  isFinal?: boolean;
}) {
  return {
    metricDate: args.date,
    spend: args.spend === undefined ? null : String(args.spend),
    impressions: args.impressions ?? null,
    clicks: args.clicks ?? null,
    purchases: args.purchases ?? null,
    purchaseValue:
      args.purchaseValue === undefined ? null : String(args.purchaseValue),
    isFinal: args.isFinal ?? true,
  };
}

const budgetChange = {
  id: "evt-budget",
  entityLevel: "adset" as const,
  entityId: "23848",
  occurredAt: new Date("2026-03-10T14:00:00.000Z"),
  changeKind: "config_change" as const,
  changedFields: { daily_budget: { old: "5000", new: "9000" } },
};

/** 05/03 a 15/03: R$ 10/dia antes da ação, R$ 20/dia depois. */
const seriePlana = [
  day({ date: "2026-03-05", spend: 10, impressions: 100, clicks: 5 }),
  day({ date: "2026-03-06", spend: 10, impressions: 100, clicks: 5 }),
  day({ date: "2026-03-07", spend: 10, impressions: 100, clicks: 5 }),
  day({ date: "2026-03-08", spend: 10, impressions: 100, clicks: 5 }),
  day({ date: "2026-03-09", spend: 10, impressions: 100, clicks: 5 }),
  day({ date: "2026-03-10", spend: 15, impressions: 150, clicks: 7 }),
  day({ date: "2026-03-11", spend: 20, impressions: 200, clicks: 9 }),
  day({ date: "2026-03-12", spend: 20, impressions: 200, clicks: 9 }),
  day({ date: "2026-03-13", spend: 20, impressions: 200, clicks: 9 }),
  day({ date: "2026-03-14", spend: 20, impressions: 200, clicks: 9 }),
  day({ date: "2026-03-15", spend: 20, impressions: 200, clicks: 9 }),
];

describe("computeActionEffect — janelas antes/depois", () => {
  test("a janela é de N dias de cada lado e o dia da ação fica de fora", () => {
    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
    });

    expect(effect.actionDay).toBe("2026-03-10");
    expect(effect.before.from).toBe("2026-03-07");
    expect(effect.before.to).toBe("2026-03-09");
    expect(effect.after.from).toBe("2026-03-11");
    expect(effect.after.to).toBe("2026-03-13");

    // 3 × R$ 10 antes, 3 × R$ 20 depois; o dia partido (R$ 15) não entra.
    expect(effect.before.spend).toBe(30);
    expect(effect.after.spend).toBe(60);
    expect(effect.actionDayMetrics?.spend).toBe(15);
  });

  test("informa quantos dias de cada lado existem de fato", () => {
    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
    });

    expect(effect.before.daysRequested).toBe(3);
    expect(effect.before.daysWithData).toBe(3);
    expect(effect.after.daysWithData).toBe(3);
    expect(effect.hasBothSides).toBe(true);
  });

  test("buraco de cobertura reduz os dias com dado, não estica a janela", () => {
    const comBuraco = seriePlana.filter(
      (point) =>
        point.metricDate !== "2026-03-08" && point.metricDate !== "2026-03-12",
    );

    const effect = computeActionEffect({
      action: budgetChange,
      series: comBuraco,
      windowDays: 3,
    });

    expect(effect.before.daysWithData).toBe(2);
    expect(effect.before.spend).toBe(20);
    expect(effect.after.daysWithData).toBe(2);
    expect(effect.after.spend).toBe(40);
    // A janela não anda para trás para "completar" três dias.
    expect(effect.before.from).toBe("2026-03-07");
    expect(effect.after.to).toBe("2026-03-13");
  });

  test("médias por dia comparam lados com contagens diferentes", () => {
    const comBuraco = seriePlana.filter(
      (point) => point.metricDate !== "2026-03-08",
    );

    const effect = computeActionEffect({
      action: budgetChange,
      series: comBuraco,
      windowDays: 3,
    });

    expect(effect.before.spendPerDay).toBe(10);
    expect(effect.after.spendPerDay).toBe(20);
    expect(effect.deltaPerDay?.spend).toBe(10);
  });

  test("ação no primeiro dia da série não tem lado anterior", () => {
    const effect = computeActionEffect({
      action: { ...budgetChange, occurredAt: new Date("2026-03-05T10:00:00Z") },
      series: seriePlana,
      windowDays: 3,
    });

    expect(effect.before.daysWithData).toBe(0);
    expect(effect.before.spend).toBe(0);
    expect(effect.before.spendPerDay).toBeNull();
    expect(effect.after.daysWithData).toBe(3);
    expect(effect.hasBothSides).toBe(false);
    expect(effect.deltaPerDay).toBeNull();
  });

  test("ação no último dia da série não tem lado posterior", () => {
    const effect = computeActionEffect({
      action: { ...budgetChange, occurredAt: new Date("2026-03-15T23:00:00Z") },
      series: seriePlana,
      windowDays: 3,
    });

    expect(effect.before.daysWithData).toBe(3);
    expect(effect.after.daysWithData).toBe(0);
    expect(effect.hasBothSides).toBe(false);
  });

  test("dia ainda dentro da janela de atribuição deixa o lado provisório", () => {
    const serieFresca = seriePlana.map((point) =>
      point.metricDate === "2026-03-12" ? { ...point, isFinal: false } : point,
    );

    const effect = computeActionEffect({
      action: budgetChange,
      series: serieFresca,
      windowDays: 3,
    });

    expect(effect.before.provisional).toBe(false);
    expect(effect.after.provisional).toBe(true);
  });

  test("compras e valor vêm das COLUNAS, não das famílias cruas", () => {
    // A dupla contagem (`purchase` + `omni_purchase`) e a reconstrução do valor
    // por ROAS são decisão da ESCRITA — `metric-columns.ts` e o teste dele. Se
    // este módulo reinterpretasse o jsonb, existiriam duas respostas para
    // "quantas compras houve".
    const serieComCompras = [
      {
        metricDate: "2026-03-09",
        spend: "100",
        purchases: 4,
        purchaseValue: "400",
        // O jsonb cru continua na linha e continua ignorado aqui.
        actions: [
          { action_type: "purchase", value: "4" },
          { action_type: "omni_purchase", value: "4" },
        ],
        isFinal: true,
      },
      {
        metricDate: "2026-03-11",
        spend: "100",
        purchases: 10,
        purchaseValue: "900",
        isFinal: true,
      },
    ];

    const effect = computeActionEffect({
      action: budgetChange,
      series: serieComCompras,
      windowDays: 1,
    });

    expect(effect.before.purchases).toBe(4);
    expect(effect.before.purchaseValue).toBe(400);
    expect(effect.before.roas).toBe(4);
    expect(effect.after.purchases).toBe(10);
    expect(effect.after.roas).toBe(9);
  });

  test("dia sem compra reportada conta como zero na soma, sem sumir da janela", () => {
    const serieSemCompra = [
      { metricDate: "2026-03-09", spend: "50", isFinal: true },
      {
        metricDate: "2026-03-11",
        spend: "50",
        purchases: 2,
        purchaseValue: "150",
        isFinal: true,
      },
    ];

    const effect = computeActionEffect({
      action: budgetChange,
      series: serieSemCompra,
      windowDays: 1,
    });

    expect(effect.before.daysWithData).toBe(1);
    expect(effect.before.purchases).toBe(0);
    expect(effect.before.roas).toBe(0);
    expect(effect.after.purchaseValue).toBe(150);
  });
});

const outraAcao = {
  id: "evt-criativo",
  entityLevel: "ad" as const,
  entityId: "23999",
  occurredAt: new Date("2026-03-12T09:00:00.000Z"),
  changeKind: "config_change" as const,
  changedFields: { creative_id: { old: "111", new: "222" } },
};

describe("computeActionEffect — confundidores", () => {
  test("outra ação dentro da janela marca a análise como confundida", () => {
    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
      concurrentActions: [outraAcao],
    });

    expect(effect.confounded).toBe(true);
    expect(effect.concurrentActions.map((item) => item.id)).toEqual([
      "evt-criativo",
    ]);
  });

  test("a ação analisada não se confunde consigo mesma", () => {
    // O invólucro devolve todas as ações da entidade, inclusive esta.
    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
      concurrentActions: [budgetChange],
    });

    expect(effect.confounded).toBe(false);
    expect(effect.concurrentActions).toEqual([]);
  });

  test("ações no mesmo instante contam como concorrentes", () => {
    const simultanea = { ...outraAcao, occurredAt: budgetChange.occurredAt };

    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
      concurrentActions: [simultanea],
    });

    expect(effect.confounded).toBe(true);
    expect(effect.concurrentActions[0]?.day).toBe("2026-03-10");
  });

  test("ação fora da janela não confunde", () => {
    const distante = {
      ...outraAcao,
      occurredAt: new Date("2026-03-14T09:00:00.000Z"),
    };

    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
      concurrentActions: [distante],
    });

    expect(effect.confounded).toBe(false);
  });

  test("concorrentes saem em ordem cronológica", () => {
    const antes = {
      ...outraAcao,
      id: "evt-antes",
      occurredAt: new Date("2026-03-08T09:00:00.000Z"),
    };

    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
      concurrentActions: [outraAcao, antes],
    });

    expect(effect.concurrentActions.map((item) => item.id)).toEqual([
      "evt-antes",
      "evt-criativo",
    ]);
  });
});

function unixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

describe("computeActionEffect — fase de aprendizado", () => {
  test("entrar em aprendizado dentro da janela é reset", () => {
    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
      learningObservations: [
        {
          at: new Date("2026-03-01T00:00:00Z"),
          learningStageInfo: { status: "SUCCESS" },
        },
        {
          at: new Date("2026-03-11T00:00:00Z"),
          learningStageInfo: { status: "LEARNING" },
        },
      ],
    });

    expect(effect.learningPhaseResetInWindow).toBe(true);
    expect(effect.learningPhaseResetSource).toBe("status_transition");
    expect(effect.learningPhaseResetAt?.toISOString()).toBe(
      "2026-03-11T00:00:00.000Z",
    );
    expect(effect.learningPhaseActiveInWindow).toBe(true);
  });

  test("aprendizado que já estava rodando antes da janela não é reset", () => {
    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
      learningObservations: [
        {
          at: new Date("2026-03-01T00:00:00Z"),
          learningStageInfo: { status: "LEARNING" },
        },
        {
          at: new Date("2026-03-11T00:00:00Z"),
          learningStageInfo: { status: "LEARNING_LIMITED" },
        },
      ],
    });

    expect(effect.learningPhaseResetInWindow).toBe(false);
    expect(effect.learningPhaseResetAt).toBeNull();
    // Mas a janela inteira correu sob aprendizado — e isso também não é
    // resultado limpo.
    expect(effect.learningPhaseActiveInWindow).toBe(true);
  });

  test("edição significativa carimbada pela Meta dentro da janela é reset", () => {
    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
      learningObservations: [
        {
          at: new Date("2026-03-12T00:00:00Z"),
          learningStageInfo: {
            status: "LEARNING",
            last_sig_edit_ts: unixSeconds("2026-03-10T14:00:00Z"),
          },
        },
      ],
    });

    expect(effect.learningPhaseResetInWindow).toBe(true);
    expect(effect.learningPhaseResetSource).toBe("last_significant_edit");
    expect(effect.learningPhaseResetAt?.toISOString()).toBe(
      "2026-03-10T14:00:00.000Z",
    );
  });

  test("edição significativa anterior à janela não é reset da janela", () => {
    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
      learningObservations: [
        {
          at: new Date("2026-03-08T00:00:00Z"),
          learningStageInfo: {
            status: "LEARNING",
            last_sig_edit_ts: unixSeconds("2026-02-20T10:00:00Z"),
          },
        },
      ],
    });

    expect(effect.learningPhaseResetInWindow).toBe(false);
    expect(effect.learningPhaseActiveInWindow).toBe(true);
  });

  test("sem informação de aprendizado, nenhuma flag é levantada", () => {
    const effect = computeActionEffect({
      action: budgetChange,
      series: seriePlana,
      windowDays: 3,
    });

    expect(effect.learningPhaseResetInWindow).toBe(false);
    expect(effect.learningPhaseActiveInWindow).toBe(false);
    expect(effect.confounded).toBe(false);
  });
});

describe("buildEntityTimeline", () => {
  const versaoNova = version({
    id: "v2",
    versionNumber: 2,
    validFrom: "2026-03-10T14:00:00.000Z",
  });

  test("no mesmo dia, a versão vem antes da ação e o resultado por último", () => {
    const timeline = buildEntityTimeline({
      versions: [versaoNova],
      actions: [budgetChange],
      series: seriePlana,
      range: { from: "2026-03-10", to: "2026-03-10" },
    });

    expect(timeline.map((entry) => entry.kind)).toEqual([
      "version",
      "action",
      "metrics",
    ]);
    expect(timeline.every((entry) => entry.day === "2026-03-10")).toBe(true);
  });

  test("o range é inclusivo nas duas pontas e corta o resto", () => {
    const timeline = buildEntityTimeline({
      versions: [versaoNova],
      actions: [budgetChange, outraAcao],
      series: seriePlana,
      range: { from: "2026-03-11", to: "2026-03-12" },
    });

    expect(timeline.map((entry) => entry.day)).toEqual([
      "2026-03-11",
      "2026-03-12",
      "2026-03-12",
    ]);
    expect(timeline.filter((entry) => entry.kind === "action")).toHaveLength(1);
  });

  test("sem range, devolve a história inteira em ordem cronológica", () => {
    const timeline = buildEntityTimeline({
      versions: [versaoNova],
      actions: [outraAcao, budgetChange],
      series: [],
    });

    expect(timeline.map((entry) => entry.day)).toEqual([
      "2026-03-10",
      "2026-03-10",
      "2026-03-12",
    ]);
  });

  test("carrega a linha do banco junto, para quem precisa do detalhe", () => {
    const timeline = buildEntityTimeline({
      versions: [],
      actions: [budgetChange],
      series: [],
    });

    const [entry] = timeline;
    expect(entry?.kind === "action" && entry.action.changedFields).toEqual({
      daily_budget: { old: "5000", new: "9000" },
    });
  });
});

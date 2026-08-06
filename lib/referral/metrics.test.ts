import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeReferralEpcCentavos,
  computeReferralTopDecile,
  emptyReferralCommissionStatusTotals,
  formatEpc,
  formatShare,
  parseReferralMetricSort,
  rankReferralAffiliates,
  referralAffiliateLiability,
  referralDaysSince,
  referralPartialReversalGap,
  referralStuckSettlementThreshold,
  REFERRAL_SETTLEMENT_STUCK_DAYS,
  summarizeReferralLiability,
  summarizeReferralProgram,
  tallyReferralCommissionStatuses,
  withDerivedReferralMetrics,
  type ReferralAffiliateMetrics,
  type ReferralAffiliateMetricsInput,
} from "./metrics";

// O que estes testes protegem: os números que decidem se o programa dá lucro.
// Cada um deles é uma definição que poderia ser escrita de outro jeito e
// continuar "parecendo certa" na tela — e é justamente por isso que ela mora
// numa função com teste, e não dentro de um `SELECT`.

const DIA = 86_400_000;

function metricsInput(
  overrides: Partial<ReferralAffiliateMetricsInput> = {},
): ReferralAffiliateMetricsInput {
  return {
    affiliateId: "aff-1",
    affiliateCode: "ABC123",
    affiliateStatus: "approved",
    user: { id: "user-1", email: "afiliado@example.com", name: "Afiliado" },
    clicks: 100,
    customers: 4,
    commissionedInvoices: 10,
    grossRevenueCentavos: 100_000,
    netRevenueCentavos: 95_000,
    reversedNetRevenueCentavos: 0,
    commissionGeneratedCentavos: 9_500,
    commissionReversedCentavos: 0,
    commissionPaidCentavos: 0,
    liability: {
      ledgerTotalCentavos: 9_500,
      inGraceCentavos: 9_500,
      openPayoutCentavos: 0,
    },
    ...overrides,
  };
}

function metrics(
  overrides: Partial<ReferralAffiliateMetricsInput> = {},
): ReferralAffiliateMetrics {
  return withDerivedReferralMetrics(metricsInput(overrides));
}

describe("comissões pelos cinco estados", () => {
  test("os cinco existem mesmo zerados", () => {
    const totals = emptyReferralCommissionStatusTotals();
    assert.deepEqual(Object.keys(totals).sort(), [
      "approved",
      "foreseen",
      "paid",
      "rejected",
      "reversed",
    ]);
  });

  test("a contagem soma por estado sem perder nenhum", () => {
    const totals = tallyReferralCommissionStatuses([
      { status: "foreseen", count: 3, amountCentavos: 3_000 },
      { status: "reversed", count: 1, amountCentavos: 1_000 },
    ]);
    assert.deepEqual(totals.foreseen, { count: 3, amountCentavos: 3_000 });
    assert.deepEqual(totals.reversed, { count: 1, amountCentavos: 1_000 });
    assert.deepEqual(totals.paid, { count: 0, amountCentavos: 0 });
  });
});

describe("Passivo de Comissão — gerado e ainda não pago", () => {
  test("o passivo é o total do ledger, e as fatias somam exatamente ele", () => {
    const liability = referralAffiliateLiability({
      ledgerTotalCentavos: 30_000,
      inGraceCentavos: 10_000,
      openPayoutCentavos: 12_000,
    });

    assert.equal(liability.totalCentavos, 30_000);
    assert.equal(liability.inGraceCentavos, 10_000);
    assert.equal(liability.heldInOpenPayoutsCentavos, 12_000);
    assert.equal(liability.readyToRequestCentavos, 8_000);
    assert.equal(
      liability.inGraceCentavos +
        liability.heldInOpenPayoutsCentavos +
        liability.readyToRequestCentavos,
      liability.totalCentavos,
    );
  });

  test("o saque aberto é FATIA do passivo, não parcela somada por fora", () => {
    // O pedido aberto não gera lançamento (ADR 0026): ele já está dentro do
    // total do ledger. Somá-lo de novo contaria o mesmo dinheiro duas vezes.
    const liability = referralAffiliateLiability({
      ledgerTotalCentavos: 20_000,
      inGraceCentavos: 0,
      openPayoutCentavos: 20_000,
    });
    assert.equal(liability.totalCentavos, 20_000);
    assert.equal(liability.heldInOpenPayoutsCentavos, 20_000);
    assert.equal(liability.readyToRequestCentavos, 0);
  });

  test("saldo negativo não vira passivo negativo", () => {
    const liability = referralAffiliateLiability({
      ledgerTotalCentavos: -19_000,
      inGraceCentavos: 0,
      openPayoutCentavos: 0,
    });
    assert.equal(liability.totalCentavos, 0);
    assert.equal(liability.readyToRequestCentavos, 0);
  });

  test("a dívida de um afiliado não abate o que se deve a outro", () => {
    const summary = summarizeReferralLiability([
      { ledgerTotalCentavos: 30_000, inGraceCentavos: 0, openPayoutCentavos: 0 },
      { ledgerTotalCentavos: -25_000, inGraceCentavos: 0, openPayoutCentavos: 0 },
    ]);
    assert.equal(summary.totalCentavos, 30_000);
    assert.equal(summary.affiliatesOwedCount, 1);
  });

  test("carência maior que o total é limitada pelo total", () => {
    // Uma reversão pendente pode derrubar o total abaixo do que está em
    // carência. A fatia não pode passar do bolo.
    const liability = referralAffiliateLiability({
      ledgerTotalCentavos: 5_000,
      inGraceCentavos: 9_000,
      openPayoutCentavos: 0,
    });
    assert.equal(liability.totalCentavos, 5_000);
    assert.equal(liability.inGraceCentavos, 5_000);
    assert.equal(liability.readyToRequestCentavos, 0);
  });

  test("um programa sem afiliado nenhum deve zero", () => {
    const summary = summarizeReferralLiability([]);
    assert.equal(summary.totalCentavos, 0);
    assert.equal(summary.affiliatesOwedCount, 0);
  });
});

describe("EPC", () => {
  test("comissão dividida pelos cliques", () => {
    assert.equal(computeReferralEpcCentavos(10_000, 200), 50);
  });

  test("sem clique é sem medida, e não eficiência zero", () => {
    assert.equal(computeReferralEpcCentavos(0, 0), null);
    assert.equal(formatEpc(null), "—");
  });

  test("o EPC do programa usa TODOS os cliques, inclusive os de quem não vendeu", () => {
    const { totals } = summarizeReferralProgram([
      metrics({ clicks: 100, commissionGeneratedCentavos: 10_000 }),
      metrics({
        affiliateCode: "ZZZ999",
        clicks: 900,
        commissionGeneratedCentavos: 0,
        netRevenueCentavos: 0,
      }),
    ]);
    assert.equal(totals.clicks, 1_000);
    assert.equal(totals.epcCentavos, 10);
  });
});

describe("concentração do top 10%", () => {
  test("com nove afiliados o topo é UM, nunca zero", () => {
    const result = computeReferralTopDecile([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    assert.equal(result.affiliateCount, 9);
    assert.equal(result.topCount, 1);
    assert.equal(result.topCentavos, 9);
  });

  test("vinte afiliados dão um topo de dois", () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    const result = computeReferralTopDecile(values);
    assert.equal(result.topCount, 2);
    assert.equal(result.topCentavos, 20 + 19);
  });

  test("um afiliado só concentra tudo", () => {
    const result = computeReferralTopDecile([100_000]);
    assert.equal(result.share, 1);
    assert.equal(formatShare(result.share), "100,0%");
  });

  test("programa vazio não tem fatia — e isso não é zero por cento", () => {
    assert.equal(computeReferralTopDecile([]).share, null);
    assert.equal(computeReferralTopDecile([0, 0, 0]).share, null);
    assert.equal(formatShare(null), "—");
  });
});

describe("margem líquida por afiliado", () => {
  test("é receita líquida menos comissão gerada, não menos comissão paga", () => {
    // O afiliado que ainda não sacou nada: medir pela comissão PAGA mostraria
    // margem cheia num afiliado que já deve toda a receita que trouxe.
    const row = metrics({
      netRevenueCentavos: 10_000,
      commissionGeneratedCentavos: 10_000,
      commissionPaidCentavos: 0,
    });
    assert.equal(row.marginCentavos, 0);
  });

  test("margem negativa é possível e é justamente o caso que a métrica existe para mostrar", () => {
    const row = metrics({
      netRevenueCentavos: 50_000,
      commissionGeneratedCentavos: 60_000,
    });
    assert.equal(row.marginCentavos, -10_000);
  });

  test("comissão revertida não conta como custo", () => {
    const row = metrics({
      commissionGeneratedCentavos: 9_500,
      commissionReversedCentavos: 4_000,
      netRevenueCentavos: 95_000,
    });
    assert.equal(row.marginCentavos, 85_500);
  });
});

describe("ranking", () => {
  const alto = metrics({
    affiliateCode: "ALTO01",
    netRevenueCentavos: 500_000,
    commissionGeneratedCentavos: 600_000,
    commissionPaidCentavos: 400_000,
  });
  const modesto = metrics({
    affiliateCode: "MODES1",
    netRevenueCentavos: 100_000,
    commissionGeneratedCentavos: 10_000,
    commissionPaidCentavos: 5_000,
  });

  test("por receita líquida, o maior primeiro", () => {
    const ranked = rankReferralAffiliates([modesto, alto], "net_revenue");
    assert.equal(ranked[0].affiliateCode, "ALTO01");
  });

  test("por comissão paga, o maior custo primeiro", () => {
    const ranked = rankReferralAffiliates([modesto, alto], "commission_paid");
    assert.equal(ranked[0].affiliateCode, "ALTO01");
  });

  test("por margem, o PIOR primeiro — é o que o ranking por receita esconde", () => {
    const ranked = rankReferralAffiliates([modesto, alto], "margin");
    assert.equal(ranked[0].affiliateCode, "ALTO01");
    assert.equal(ranked[0].marginCentavos, -100_000);
    assert.equal(ranked[1].affiliateCode, "MODES1");
  });

  test("o desempate é estável — duas cargas iguais não trocam linhas de lugar", () => {
    const a = metrics({ affiliateCode: "BBB222", commissionPaidCentavos: 0 });
    const b = metrics({ affiliateCode: "AAA111", commissionPaidCentavos: 0 });
    const ranked = rankReferralAffiliates([a, b], "commission_paid");
    assert.deepEqual(
      ranked.map((row) => row.affiliateCode),
      ["AAA111", "BBB222"],
    );
  });

  test("ordenar não mexe no array recebido", () => {
    const rows = [modesto, alto];
    rankReferralAffiliates(rows, "net_revenue");
    assert.equal(rows[0].affiliateCode, "MODES1");
  });

  test("um parâmetro desconhecido cai na receita líquida", () => {
    assert.equal(parseReferralMetricSort("qualquer-coisa"), "net_revenue");
    assert.equal(parseReferralMetricSort(null), "net_revenue");
    assert.equal(parseReferralMetricSort("margin"), "margin");
  });
});

describe("totais do programa", () => {
  test("os totais são a soma das linhas, não uma segunda consulta", () => {
    const { totals } = summarizeReferralProgram([
      metrics({
        clicks: 100,
        customers: 2,
        commissionedInvoices: 5,
        grossRevenueCentavos: 100_000,
        netRevenueCentavos: 95_000,
        commissionGeneratedCentavos: 9_500,
        commissionPaidCentavos: 4_000,
      }),
      metrics({
        affiliateCode: "SEG002",
        clicks: 50,
        customers: 1,
        commissionedInvoices: 2,
        grossRevenueCentavos: 40_000,
        netRevenueCentavos: 38_000,
        commissionGeneratedCentavos: 3_800,
        commissionPaidCentavos: 0,
      }),
    ]);

    assert.equal(totals.clicks, 150);
    assert.equal(totals.customers, 3);
    assert.equal(totals.commissionedInvoices, 7);
    assert.equal(totals.netRevenueCentavos, 133_000);
    assert.equal(totals.commissionGeneratedCentavos, 13_300);
    assert.equal(totals.commissionPaidCentavos, 4_000);
    assert.equal(totals.marginCentavos, 119_700);
  });
});

describe("alerta de liquidação presa", () => {
  const agora = new Date("2026-08-06T12:00:00.000Z");

  test("o limite padrão é de três dias", () => {
    assert.equal(REFERRAL_SETTLEMENT_STUCK_DAYS, 3);
    assert.equal(
      referralStuckSettlementThreshold(agora).toISOString(),
      new Date(agora.getTime() - 3 * DIA).toISOString(),
    );
  });

  test("conta dias inteiros desde o evento", () => {
    assert.equal(
      referralDaysSince(new Date(agora.getTime() - 3.5 * DIA), agora),
      3,
    );
  });

  test("um evento no futuro não está atrasado", () => {
    assert.equal(referralDaysSince(new Date(agora.getTime() + DIA), agora), 0);
  });
});

describe("alerta de estorno parcial", () => {
  test("a lacuna é o que faltou devolver", () => {
    assert.equal(referralPartialReversalGap(10_000, 9_900), 100);
  });

  test("estorno total não deixa lacuna", () => {
    assert.equal(referralPartialReversalGap(10_000, 10_000), 0);
  });

  test("devolver mais que o pago também não é a anomalia que o alerta procura", () => {
    assert.equal(referralPartialReversalGap(10_000, 12_000), 0);
  });
});

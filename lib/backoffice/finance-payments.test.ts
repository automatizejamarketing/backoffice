import { describe, expect, test } from "bun:test";
import type { ProductFinancialModel } from "@/lib/db/schema";
import {
  describeAutomatizePaymentSequence,
  describeProductPaymentProvider,
  formatGatewayFeeEstimateLabel,
  resolveAutomatizePaymentAmounts,
  resolveProductPaymentAmounts,
  resolveProductPaymentNetAmounts,
  summarizeAutomatizePayments,
  summarizeProductPayments,
  summarizeProductPaymentsByProduct,
  summarizeProductPaymentsBySettlementRail,
  listAutomatizePaymentNetGaps,
  resolveExpertSettlementRail,
} from "./finance-payments";

const automatizePaymentFixture = {
  id: "p1",
  paidAt: new Date("2026-08-01T12:00:00Z"),
  createdAt: new Date("2026-08-01T12:00:00Z"),
  userId: "u1",
  userEmail: "a@example.com",
  planType: "monthly_pro" as const,
  provider: "stripe" as const,
  amount: 10000,
  grossAmount: null,
  netAmount: null,
  feeAmount: null,
  currency: "brl",
  stripeInvoiceId: "inv_1",
  mercadopagoPaymentId: null,
  description: null,
  paymentNumber: 1,
};

const productPaymentFixture = {
  id: "pp1",
  orderId: "o1",
  productTitle: "Curso expert",
  buyerName: "Maria",
  buyerEmail: "maria@example.com",
  approvedAt: new Date("2026-08-02T12:00:00Z"),
  createdAt: new Date("2026-08-02T11:00:00Z"),
  provider: "mercadopago",
  providerPaymentId: "123",
  paymentMethodId: null,
  paymentTypeId: null,
  grossAmountCentavos: 20000,
  netAmountCentavos: 19000,
  feeAmountCentavos: 1000,
  priceCentavos: 20000,
  ownerType: "expert" as const,
  financialModel: "legacy_net_split" as const,
  platformFeeBasisPoints: null,
  platformFeeFixedCentavos: null,
  platformFeeGrossCentavos: null,
  automatizeCoproductionRevenueCentavos: null,
  automatizeProductRevenueCentavos: null,
  automatizeTotalNetRevenueCentavos: null,
  expertShareBasisPoints: 9000,
  coproducerShareBasisPoints: 0,
  coproducerTypeSnapshot: null,
  expertSettlement: null,
  ownerExpertReceivableCentavos: null,
  gatewayFeeEstimateBps: null,
  gatewayFeeEstimateFixedCentavos: null,
  expertRevenueCentavos: 17100,
};

describe("finance payments summaries", () => {
  test("summarizes automatize payments with stripe settlement overrides", () => {
    const summary = summarizeAutomatizePayments(
      [automatizePaymentFixture],
      [
        {
          invoiceId: "inv_1",
          grossAmount: 10000,
          netAmount: 9500,
          feeAmount: 500,
        },
      ],
    );

    expect(summary.count).toBe(1);
    expect(summary.grossCentavos).toBe(10000);
    expect(summary.netCentavos).toBe(9500);
    expect(summary.feeCentavos).toBe(500);
    expect(summary.netBreakdown).toEqual({
      newSubscriptionNetCentavos: 9500,
      renewalNetCentavos: 0,
      newSubscriptionCount: 1,
      renewalCount: 0,
    });
  });

  test("splits automatize net between new subscriptions and renewals", () => {
    const summary = summarizeAutomatizePayments(
      [
        automatizePaymentFixture,
        {
          ...automatizePaymentFixture,
          id: "p2",
          paymentNumber: 2,
          amount: 5000,
          stripeInvoiceId: "inv_2",
        },
        {
          ...automatizePaymentFixture,
          id: "p3",
          userId: "u2",
          userEmail: "b@example.com",
          paymentNumber: 1,
          amount: 3000,
          stripeInvoiceId: "inv_3",
        },
      ],
      [
        {
          invoiceId: "inv_1",
          grossAmount: 10000,
          netAmount: 9500,
          feeAmount: 500,
        },
        {
          invoiceId: "inv_2",
          grossAmount: 5000,
          netAmount: 4800,
          feeAmount: 200,
        },
        {
          invoiceId: "inv_3",
          grossAmount: 3000,
          netAmount: 2900,
          feeAmount: 100,
        },
      ],
    );

    expect(summary.netCentavos).toBe(17200);
    expect(summary.netBreakdown).toEqual({
      newSubscriptionNetCentavos: 12400,
      renewalNetCentavos: 4800,
      newSubscriptionCount: 2,
      renewalCount: 1,
    });
  });

  test("summarizes product payments using automatize net after expert share", () => {
    const summary = summarizeProductPayments([productPaymentFixture]);

    expect(summary.count).toBe(1);
    expect(summary.grossCentavos).toBe(20000);
    expect(summary.netCentavos).toBe(1900);
  });

  test("keeps full gateway net for automatize-owned products", () => {
    const amounts = resolveProductPaymentAmounts({
      ...productPaymentFixture,
      id: "pp2",
      orderId: "o2",
      productTitle: "Curso Automatize",
      buyerName: "João",
      buyerEmail: "joao@example.com",
      providerPaymentId: "456",
      grossAmountCentavos: 10000,
      netAmountCentavos: 9500,
      feeAmountCentavos: 500,
      priceCentavos: 10000,
      ownerType: "automatize",
      expertShareBasisPoints: 0,
      expertRevenueCentavos: null,
    });

    expect(amounts.revenueKind).toBe("coproducao");
    expect(amounts.automatizeNetCentavos).toBe(9500);
  });

  test("ignores expert ledger when automatize owns the product", () => {
    const amounts = resolveProductPaymentAmounts({
      ...productPaymentFixture,
      id: "pp4",
      orderId: "o4",
      productTitle: "Coprodução Automatize",
      buyerName: "Luiza",
      buyerEmail: "luiza@example.com",
      providerPaymentId: "999",
      grossAmountCentavos: 10000,
      netAmountCentavos: 9500,
      feeAmountCentavos: 500,
      priceCentavos: 10000,
      ownerType: "automatize",
      expertShareBasisPoints: 6000,
      expertRevenueCentavos: 5700,
    });

    expect(amounts.revenueKind).toBe("coproducao");
    expect(amounts.automatizeNetCentavos).toBe(9500);
  });

  test("falls back to basis points when ledger exceeds gateway net", () => {
    const amounts = resolveProductPaymentAmounts({
      ...productPaymentFixture,
      id: "pp5",
      orderId: "o5",
      productTitle: "Curso expert",
      buyerName: "Pedro",
      buyerEmail: "pedro@example.com",
      providerPaymentId: "1000",
      grossAmountCentavos: 8799,
      netAmountCentavos: 8614,
      feeAmountCentavos: 185,
      priceCentavos: 8799,
      expertShareBasisPoints: 9500,
      expertRevenueCentavos: 9000,
    });

    expect(amounts.expertRevenueCentavos).toBe(8183);
    expect(amounts.automatizeNetCentavos).toBe(431);
  });

  test("derives expert share from basis points when ledger is missing", () => {
    const amounts = resolveProductPaymentAmounts({
      ...productPaymentFixture,
      id: "pp3",
      orderId: "o3",
      productTitle: "Curso expert",
      buyerName: "Ana",
      buyerEmail: "ana@example.com",
      providerPaymentId: "789",
      grossAmountCentavos: 8799,
      netAmountCentavos: 8614,
      feeAmountCentavos: 185,
      priceCentavos: 8799,
      expertShareBasisPoints: 9500,
      expertRevenueCentavos: null,
    });

    expect(amounts.revenueKind).toBe("taxa");
    expect(amounts.expertRevenueCentavos).toBe(8183);
    expect(amounts.automatizeNetCentavos).toBe(431);
  });

  test("uses platform fee net for v2 expert products instead of legacy split", () => {
    const amounts = resolveProductPaymentAmounts({
      ...productPaymentFixture,
      id: "pp6",
      orderId: "o6",
      productTitle: "Produto do JP",
      buyerName: "Cliente",
      buyerEmail: "cliente@example.com",
      providerPaymentId: "2000",
      grossAmountCentavos: 1000,
      netAmountCentavos: 921,
      feeAmountCentavos: 79,
      priceCentavos: 1000,
      financialModel: "platform_fee_coproduction_v2",
      platformFeeBasisPoints: 500,
      platformFeeGrossCentavos: 50,
      automatizeTotalNetRevenueCentavos: -29,
      expertShareBasisPoints: 10000,
      expertRevenueCentavos: 950,
    });

    expect(amounts.automatizeNetCentavos).toBe(-29);
    expect(amounts.platformFeeGrossCentavos).toBe(50);
  });

  test("derives the v3 percentage plus fixed fee when settlement fields are absent", () => {
    const amounts = resolveProductPaymentAmounts({
      ...productPaymentFixture,
      financialModel: "platform_fee_coproduction_v3",
      grossAmountCentavos: 10_000,
      netAmountCentavos: 9_602,
      feeAmountCentavos: 398,
      priceCentavos: 10_000,
      platformFeeBasisPoints: 549,
      platformFeeFixedCentavos: 39,
      platformFeeGrossCentavos: null,
      expertShareBasisPoints: 10_000,
      expertRevenueCentavos: 9_412,
    });

    expect(amounts.platformFeeGrossCentavos).toBe(588);
    expect(amounts.automatizeNetCentavos).toBe(190);
  });

  test("keeps the full gateway net for v3 automatize products", () => {
    const amounts = resolveProductPaymentAmounts({
      ...productPaymentFixture,
      ownerType: "automatize" as const,
      financialModel: "platform_fee_coproduction_v3",
      grossAmountCentavos: 10_000,
      netAmountCentavos: 9_602,
      feeAmountCentavos: 398,
      priceCentavos: 10_000,
      platformFeeBasisPoints: 0,
      platformFeeFixedCentavos: 0,
      platformFeeGrossCentavos: null,
      expertShareBasisPoints: 0,
      expertRevenueCentavos: null,
    });

    expect(amounts.platformFeeGrossCentavos).toBe(0);
    expect(amounts.automatizeNetCentavos).toBe(9_602);
  });

  test("aggregates negative platform net revenue without breaking the product list", () => {
    const payment = {
      ...productPaymentFixture,
      financialModel: "platform_fee_coproduction_v2" as const,
      platformFeeBasisPoints: 500,
      platformFeeGrossCentavos: 50,
      automatizeTotalNetRevenueCentavos: -29,
      expertShareBasisPoints: 10000,
      expertRevenueCentavos: 950,
      grossAmountCentavos: 1000,
      netAmountCentavos: 921,
      feeAmountCentavos: 79,
      priceCentavos: 1000,
    };

    const summaries = summarizeProductPaymentsByProduct([
      { ...payment, id: "pp6", orderId: "o6", productId: "product-1" },
      { ...payment, id: "pp7", orderId: "o7", productId: "product-1" },
    ]);

    expect(summaries.get("product-1")).toEqual({
      grossRevenueCentavos: 2000,
      automatizeNetRevenueCentavos: -58,
    });
  });

  test("labels stripe product payments as card with stripe reference", () => {
    expect(
      describeProductPaymentProvider({
        provider: "stripe",
        paymentMethodId: "card",
        paymentTypeId: null,
        providerPaymentId: "pi_123",
      }),
    ).toEqual({
      methodLabel: "Cartão",
      referenceLabel: "Stripe pi_123",
    });
  });

  test("resolves manual automatize payments without fee as full net", () => {
    const amounts = resolveAutomatizePaymentAmounts({
      amount: 5000,
      grossAmount: null,
      netAmount: null,
      feeAmount: null,
      provider: "manual",
      stripeInvoiceId: null,
    });

    expect(amounts.gross).toBe(5000);
    expect(amounts.net).toBe(5000);
    expect(amounts.hasNetCoverage).toBe(true);
    expect(amounts.missingNetReason).toBeNull();
  });

  test("flags mercadopago payments without settlement data", () => {
    const amounts = resolveAutomatizePaymentAmounts({
      amount: 9900,
      grossAmount: null,
      netAmount: null,
      feeAmount: null,
      provider: "mercadopago",
      stripeInvoiceId: null,
    });

    expect(amounts.net).toBeNull();
    expect(amounts.hasNetCoverage).toBe(false);
    expect(amounts.missingNetReason).toBe("mercadopago_fees_pending");
  });

  test("lists automatize payment net gaps by provider", () => {
    const gaps = listAutomatizePaymentNetGaps(
      [
        {
          ...automatizePaymentFixture,
          id: "p1",
          provider: "mercadopago",
          amount: 9900,
          stripeInvoiceId: null,
          mercadopagoPaymentId: "12345",
          paymentNumber: 2,
        },
        {
          ...automatizePaymentFixture,
          id: "p2",
          paidAt: new Date("2026-08-02T12:00:00Z"),
          createdAt: new Date("2026-08-02T12:00:00Z"),
          userId: "u2",
          userEmail: "b@example.com",
          stripeInvoiceId: "inv_missing",
          paymentNumber: 1,
        },
      ],
      [],
    );

    expect(gaps).toHaveLength(2);
    expect(gaps[0]?.reason).toBe("mercadopago_fees_pending");
    expect(gaps[1]?.reason).toBe("stripe_settlement_unavailable");
  });

  test("leaves historical unclassified payments without a settlement gap reason", () => {
    const amounts = resolveAutomatizePaymentAmounts({
      amount: 29_700,
      grossAmount: 29_700,
      netAmount: null,
      feeAmount: null,
      provider: "vindi",
      stripeInvoiceId: null,
    });

    expect(amounts.net).toBeNull();
    expect(amounts.hasNetCoverage).toBe(false);
    expect(amounts.missingNetReason).toBeNull();
  });

  test("keeps historical unclassified billing rows out of settlement gaps", () => {
    const gaps = listAutomatizePaymentNetGaps(
      [
        {
          ...automatizePaymentFixture,
          id: "historical-gap",
          provider: "vindi",
          amount: 29_700,
          grossAmount: 29_700,
          stripeInvoiceId: null,
          mercadopagoPaymentId: null,
          paymentMethod: "credit_card",
          purpose: "subscription",
        },
        {
          ...automatizePaymentFixture,
          id: "product-row",
          provider: "vindi",
          amount: 10_000,
          stripeInvoiceId: null,
          purpose: "product",
        },
      ],
      [],
    );

    expect(gaps).toHaveLength(0);
  });

  test("keeps product and pack rows out of the automatize billing summary", () => {
    const summary = summarizeAutomatizePayments(
      [
        {
          ...automatizePaymentFixture,
          provider: "vindi",
          amount: 29_700,
          grossAmount: 29_700,
          netAmount: 28_353,
          feeAmount: 1_347,
          stripeInvoiceId: null,
          purpose: "subscription",
        },
        {
          ...automatizePaymentFixture,
          id: "product-row",
          provider: "vindi",
          amount: 10_000,
          grossAmount: 10_000,
          netAmount: 9_451,
          feeAmount: 549,
          stripeInvoiceId: null,
          purpose: "product",
        },
      ],
      [],
    );

    expect(summary.count).toBe(1);
    expect(summary.grossCentavos).toBe(29_700);
    expect(summary.netCentavos).toBe(28_353);
  });

  test("labels historical unclassified product payments without naming Vindi", () => {
    expect(
      describeProductPaymentProvider({
        provider: "vindi",
        paymentMethodId: "credit_card",
        paymentTypeId: null,
        providerPaymentId: "88002",
      }),
    ).toEqual({
      methodLabel: "sem classificação",
      referenceLabel: "88002",
    });
    expect(
      describeProductPaymentProvider({
        provider: "vindi",
        paymentMethodId: "pix",
        paymentTypeId: null,
        providerPaymentId: "88003",
      }),
    ).toEqual({
      methodLabel: "sem classificação",
      referenceLabel: "88003",
    });
    expect(
      describeProductPaymentProvider({
        provider: "vindi",
        paymentMethodId: null,
        paymentTypeId: null,
        providerPaymentId: null,
      }),
    ).toEqual({
      methodLabel: "sem classificação",
      referenceLabel: null,
    });
  });

  test("describes first payment as new subscription and later as renewal", () => {
    expect(describeAutomatizePaymentSequence(1)).toEqual({
      paymentNumber: 1,
      kind: "new_subscription",
      badgeLabel: "Assinatura nova",
    });
    expect(describeAutomatizePaymentSequence(3)).toEqual({
      paymentNumber: 3,
      kind: "renewal",
      badgeLabel: "Renovação",
    });
  });
});

describe("pedidos históricos vindi_split_v1", () => {
  const legacyVindiSplitFixture = {
    ...productPaymentFixture,
    financialModel: "vindi_split_v1" as ProductFinancialModel,
    expertShareBasisPoints: 0,
    expertRevenueCentavos: null,
    automatizeCoproductionRevenueCentavos: null,
    automatizeProductRevenueCentavos: null,
    automatizeTotalNetRevenueCentavos: null,
    grossAmountCentavos: 10000,
    netAmountCentavos: 10000,
    feeAmountCentavos: null,
    priceCentavos: 10000,
  };

  const vindiSplitWithSnapshots = {
    ...legacyVindiSplitFixture,
    expertRevenueCentavos: 7561,
    automatizeTotalNetRevenueCentavos: 1890,
  };

  test("usa snapshots congelados para receita expert e Automatize", () => {
    const amounts = resolveProductPaymentAmounts(vindiSplitWithSnapshots);

    expect(amounts.expertRevenueCentavos).toBe(7561);
    expect(amounts.automatizeNetCentavos).toBe(1890);
  });

  test("sem automatizeTotalNetRevenueCentavos, deriva do expertRevenueCentavos", () => {
    const amounts = resolveProductPaymentAmounts({
      ...vindiSplitWithSnapshots,
      automatizeTotalNetRevenueCentavos: null,
    });

    expect(amounts.expertRevenueCentavos).toBe(7561);
    expect(amounts.automatizeNetCentavos).toBe(2439);
  });

  test("sem snapshot suficiente, repasse e receita ficam sem classificação", () => {
    const amounts = resolveProductPaymentAmounts(legacyVindiSplitFixture);
    const netAmounts = resolveProductPaymentNetAmounts(legacyVindiSplitFixture);

    expect(amounts.expertRevenueCentavos).toBe(0);
    expect(amounts.automatizeNetCentavos).toBeNull();
    expect(netAmounts.expertSettlementRail).toBeNull();
    expect(netAmounts.expertSettlementLabel).toBeNull();
  });

  test("com snapshot expert, trilho de repasse é Repasse Manual", () => {
    const netAmounts = resolveProductPaymentNetAmounts(vindiSplitWithSnapshots);

    expect(netAmounts.expertSettlementRail).toBe("ledger");
    expect(netAmounts.expertSettlementLabel).toBe("Repasse Manual");
  });

  test("produto do Automatize continua ficando com o líquido inteiro", () => {
    const amounts = resolveProductPaymentAmounts({
      ...legacyVindiSplitFixture,
      ownerType: "automatize" as const,
    });

    expect(amounts.automatizeNetCentavos).toBe(10000);
  });

  test("os modelos antigos não mudam de comportamento", () => {
    const amounts = resolveProductPaymentAmounts(productPaymentFixture);

    expect(amounts.expertRevenueCentavos).toBe(17100);
    expect(amounts.automatizeNetCentavos).toBe(1900);
  });
});

describe("relatório líquido gateway_net_v1", () => {
  test("Pix MP reparte o líquido real entre Expert e Coprodução do Automatize com Repasse Manual", () => {
    const amounts = resolveProductPaymentNetAmounts({
      ...productPaymentFixture,
      financialModel: "gateway_net_v1",
      provider: "mercadopago",
      grossAmountCentavos: 4_700,
      netAmountCentavos: 4_601,
      feeAmountCentavos: 99,
      priceCentavos: 4_700,
      expertShareBasisPoints: 10_000,
      coproducerShareBasisPoints: 0,
      coproducerTypeSnapshot: null,
      expertSettlement: "ledger",
      ownerExpertReceivableCentavos: 4_601,
      automatizeCoproductionRevenueCentavos: 0,
      automatizeTotalNetRevenueCentavos: 0,
      expertRevenueCentavos: 4_601,
    });

    expect(amounts.netCentavos).toBe(4_601);
    expect(amounts.expertRevenueCentavos).toBe(4_601);
    expect(amounts.automatizeRevenueCentavos).toBe(0);
    expect(amounts.expertSettlementLabel).toBe("Repasse Manual");
    expect(amounts.countsTowardExpertPayableBalance).toBe(true);
  });

  test("cartão Stripe Cobrança Direta fica com Repasse pelo Gateway e sem saldo a pagar", () => {
    const amounts = resolveProductPaymentNetAmounts({
      ...productPaymentFixture,
      financialModel: "gateway_net_v1",
      provider: "stripe",
      grossAmountCentavos: 10_000,
      netAmountCentavos: 7_649,
      feeAmountCentavos: 439,
      priceCentavos: 10_000,
      expertShareBasisPoints: 8_000,
      coproducerShareBasisPoints: 2_000,
      coproducerTypeSnapshot: "automatize",
      expertSettlement: "gateway",
      ownerExpertReceivableCentavos: 7_649,
      automatizeCoproductionRevenueCentavos: 1_912,
      automatizeTotalNetRevenueCentavos: 1_912,
      gatewayFeeEstimateBps: 399,
      gatewayFeeEstimateFixedCentavos: 40,
      expertRevenueCentavos: null,
    });

    expect(amounts.netCentavos).toBe(9_561);
    expect(amounts.expertRevenueCentavos).toBe(7_649);
    expect(amounts.automatizeRevenueCentavos).toBe(1_912);
    expect(amounts.expertSettlementLabel).toBe("Repasse pelo Gateway");
    expect(amounts.countsTowardExpertPayableBalance).toBe(false);
    expect(amounts.gatewayFeeEstimateLabel).toBe("3,99% + R$ 0,40");
  });

  test("totais do período separam trilhos de repasse e somam saldo a pagar só do ledger", () => {
    const settlement = summarizeProductPaymentsBySettlementRail([
      {
        ...productPaymentFixture,
        financialModel: "gateway_net_v1",
        provider: "stripe",
        grossAmountCentavos: 10_000,
        netAmountCentavos: 9_000,
        feeAmountCentavos: 1_000,
        expertSettlement: "gateway",
        ownerExpertReceivableCentavos: 9_000,
        automatizeTotalNetRevenueCentavos: 0,
      },
      {
        ...productPaymentFixture,
        id: "pp-ledger",
        orderId: "o-ledger",
        financialModel: "gateway_net_v1",
        provider: "mercadopago",
        grossAmountCentavos: 4_700,
        netAmountCentavos: 4_601,
        feeAmountCentavos: 99,
        expertSettlement: "ledger",
        ownerExpertReceivableCentavos: 4_601,
        automatizeTotalNetRevenueCentavos: 0,
        expertRevenueCentavos: 4_601,
      },
    ]);

    expect(settlement.gateway.count).toBe(1);
    expect(settlement.gateway.expertRevenueCentavos).toBe(9_000);
    expect(settlement.ledger.count).toBe(1);
    expect(settlement.ledger.expertRevenueCentavos).toBe(4_601);
    expect(settlement.expertPayableCentavos).toBe(4_601);
  });

  test("Tarifa Estimada do Gateway não aparece quando estimativa é nula", () => {
    expect(
      formatGatewayFeeEstimateLabel({
        financialModel: "gateway_net_v1",
        provider: "stripe",
        gatewayFeeEstimateBps: null,
        gatewayFeeEstimateFixedCentavos: null,
      }),
    ).toBeNull();
  });

  test("Tarifa Estimada do Gateway não aparece em modelos legados", () => {
    expect(
      formatGatewayFeeEstimateLabel({
        financialModel: "legacy_net_split",
        provider: "stripe",
        gatewayFeeEstimateBps: null,
        gatewayFeeEstimateFixedCentavos: null,
      }),
    ).toBeNull();
  });
});

describe("gateway_net_v1 trilho de repasse na leitura", () => {
  const gatewayNetV1CardFixture = {
    ...productPaymentFixture,
    financialModel: "gateway_net_v1" as const,
    provider: "stripe" as const,
    grossAmountCentavos: 10_000,
    netAmountCentavos: 9_561,
    feeAmountCentavos: 439,
    priceCentavos: 10_000,
    expertShareBasisPoints: 8_000,
    coproducerShareBasisPoints: 2_000,
    coproducerTypeSnapshot: "automatize" as const,
    ownerExpertReceivableCentavos: null,
    automatizeCoproductionRevenueCentavos: null,
    automatizeTotalNetRevenueCentavos: null,
    expertRevenueCentavos: null,
    gatewayFeeEstimateBps: 399,
    gatewayFeeEstimateFixedCentavos: 40,
  };

  test("expert_settlement gateway → Repasse pelo Gateway", () => {
    const payment = {
      ...gatewayNetV1CardFixture,
      expertSettlement: "gateway" as const,
      ownerExpertReceivableCentavos: 7_649,
      automatizeCoproductionRevenueCentavos: 1_912,
      automatizeTotalNetRevenueCentavos: 1_912,
    };

    expect(resolveExpertSettlementRail(payment)).toBe("gateway");

    const amounts = resolveProductPaymentNetAmounts(payment);
    expect(amounts.expertRevenueCentavos).toBe(7_649);
    expect(amounts.automatizeRevenueCentavos).toBe(1_912);
    expect(amounts.expertSettlementRail).toBe("gateway");
    expect(amounts.expertSettlementLabel).toBe("Repasse pelo Gateway");
    expect(amounts.countsTowardExpertPayableBalance).toBe(false);
  });

  test("expert_settlement ledger → Repasse Manual", () => {
    const payment = {
      ...gatewayNetV1CardFixture,
      provider: "mercadopago" as const,
      expertSettlement: "ledger" as const,
      ownerExpertReceivableCentavos: 4_601,
      expertRevenueCentavos: 4_601,
      grossAmountCentavos: 4_700,
      netAmountCentavos: 4_601,
      feeAmountCentavos: 99,
      priceCentavos: 4_700,
      expertShareBasisPoints: 10_000,
      coproducerShareBasisPoints: 0,
      coproducerTypeSnapshot: null,
    };

    expect(resolveExpertSettlementRail(payment)).toBe("ledger");

    const amounts = resolveProductPaymentNetAmounts(payment);
    expect(amounts.expertRevenueCentavos).toBe(4_601);
    expect(amounts.expertSettlementRail).toBe("ledger");
    expect(amounts.expertSettlementLabel).toBe("Repasse Manual");
    expect(amounts.countsTowardExpertPayableBalance).toBe(true);
  });

  test("cartão Stripe sem expert_settlement → sem classificação, nunca gateway", () => {
    const payment = {
      ...gatewayNetV1CardFixture,
      expertSettlement: null,
    };

    expect(resolveExpertSettlementRail(payment)).toBeNull();

    const amounts = resolveProductPaymentNetAmounts(payment);
    expect(amounts.expertRevenueCentavos).toBe(0);
    expect(amounts.automatizeRevenueCentavos).toBeNull();
    expect(amounts.expertSettlementRail).toBeNull();
    expect(amounts.expertSettlementLabel).toBeNull();
    expect(amounts.countsTowardExpertPayableBalance).toBe(false);
  });
});

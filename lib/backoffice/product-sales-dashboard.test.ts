import { describe, expect, test } from "bun:test";
import {
  buildProductSalesDashboard,
  classifyProductSalesMethod,
  resolveProductSalesWindow,
  type ProductSalesOrderRow,
} from "./product-sales-dashboard";

// 10/09/2026 15:00 BRT.
const NOW = new Date("2026-09-10T18:00:00.000Z");

function row(overrides: Partial<ProductSalesOrderRow>): ProductSalesOrderRow {
  return {
    orderId: "order",
    productId: "product",
    createdAt: new Date("2026-09-10T13:00:00.000Z"),
    approvedAt: null,
    refundedAt: null,
    orderStatus: "pending",
    paymentStatus: "pending",
    provider: "stripe",
    paymentMethodId: null,
    paymentTypeId: "credit_card",
    grossAmountCentavos: 10_000,
    netAmountCentavos: 9_500,
    feeAmountCentavos: 500,
    priceCentavos: 10_000,
    ownerType: "expert",
    financialModel: "gateway_net_v1",
    platformFeeBasisPoints: 500,
    platformFeeFixedCentavos: 0,
    platformFeeGrossCentavos: 500,
    automatizeCoproductionRevenueCentavos: 0,
    automatizeProductRevenueCentavos: 0,
    automatizeTotalNetRevenueCentavos: 3_000,
    expertShareBasisPoints: 0,
    coproducerShareBasisPoints: 0,
    coproducerTypeSnapshot: null,
    expertSettlement: null,
    ownerExpertReceivableCentavos: null,
    gatewayFeeEstimateBps: null,
    gatewayFeeEstimateFixedCentavos: null,
    expertRevenueCentavos: null,
    ...overrides,
  };
}

describe("resolveProductSalesWindow", () => {
  test("um dia só usa a fronteira BRT e série por hora", () => {
    const window = resolveProductSalesWindow(
      { from: "2026-09-10", to: "2026-09-10" },
      NOW,
    );
    expect(window.fromDate).toBe("2026-09-10");
    expect(window.throughDate).toBe("2026-09-10");
    expect(window.gte.toISOString()).toBe("2026-09-10T03:00:00.000Z");
    expect(window.lt.toISOString()).toBe("2026-09-11T03:00:00.000Z");
    expect(window.bucket).toBe("hour");
  });

  test("sem datas cai em hoje pela data de calendário BRT", () => {
    // 01:00 UTC do dia 11 ainda é dia 10 em BRT.
    const window = resolveProductSalesWindow({}, new Date("2026-09-11T01:00:00.000Z"));
    expect(window).toMatchObject({ fromDate: "2026-09-10", throughDate: "2026-09-10", bucket: "hour" });
  });

  test("intervalo de vários dias vira série diária; datas invertidas são corrigidas", () => {
    expect(resolveProductSalesWindow({ from: "2026-09-04", to: "2026-09-10" }, NOW)).toMatchObject({
      fromDate: "2026-09-04",
      throughDate: "2026-09-10",
      bucket: "day",
    });
    expect(resolveProductSalesWindow({ from: "2026-09-10", to: "2026-09-04" }, NOW)).toMatchObject({
      fromDate: "2026-09-04",
      throughDate: "2026-09-10",
    });
  });

  test("futuro é cortado em hoje, lixo cai em hoje, e a janela não passa de um ano", () => {
    expect(resolveProductSalesWindow({ from: "2026-09-01", to: "2026-12-31" }, NOW)).toMatchObject({
      fromDate: "2026-09-01",
      throughDate: "2026-09-10",
    });
    expect(resolveProductSalesWindow({ from: "2026-02-30", to: "x" }, NOW)).toMatchObject({
      fromDate: "2026-09-10",
      throughDate: "2026-09-10",
    });
    expect(resolveProductSalesWindow({ from: "2020-01-01", to: "2026-09-10" }, NOW)).toMatchObject({
      fromDate: "2025-09-10",
      throughDate: "2026-09-10",
    });
  });
});

describe("classifyProductSalesMethod", () => {
  test("pix por método, tipo ou provedor Mercado Pago", () => {
    expect(classifyProductSalesMethod({ provider: "stripe", paymentMethodId: "pix", paymentTypeId: null })).toBe("pix");
    expect(classifyProductSalesMethod({ provider: null, paymentMethodId: null, paymentTypeId: "bank_transfer" })).toBe("pix");
    expect(classifyProductSalesMethod({ provider: "mercadopago", paymentMethodId: null, paymentTypeId: null })).toBe("pix");
  });

  test("cartão por Stripe ou tipo de cartão; sem pagamento é desconhecido", () => {
    expect(classifyProductSalesMethod({ provider: "stripe", paymentMethodId: null, paymentTypeId: null })).toBe("card");
    expect(classifyProductSalesMethod({ provider: null, paymentMethodId: "visa", paymentTypeId: "credit_card" })).toBe("card");
    expect(classifyProductSalesMethod({ provider: null, paymentMethodId: null, paymentTypeId: null })).toBe("unknown");
  });
});

describe("buildProductSalesDashboard", () => {
  const window = resolveProductSalesWindow({ from: "2026-09-10", to: "2026-09-10" }, NOW);

  test("conta vendas e líquido pelo dia da aprovação, inclusive pedido criado antes", () => {
    const rows = [
      row({ orderId: "a", orderStatus: "approved", paymentStatus: "approved", approvedAt: new Date("2026-09-10T13:30:00.000Z") }),
      row({
        orderId: "b",
        orderStatus: "approved",
        paymentStatus: "approved",
        createdAt: new Date("2026-09-09T20:00:00.000Z"),
        approvedAt: new Date("2026-09-10T22:10:00.000Z"),
        grossAmountCentavos: 5_000,
        priceCentavos: 5_000,
        automatizeTotalNetRevenueCentavos: 1_000,
      }),
      // Aprovado ontem: fora.
      row({ orderId: "c", orderStatus: "approved", paymentStatus: "approved", approvedAt: new Date("2026-09-09T13:30:00.000Z") }),
    ];
    const { summary, series } = buildProductSalesDashboard(rows, window);
    expect(summary.salesCount).toBe(2);
    expect(summary.grossCentavos).toBe(15_000);
    expect(summary.netCentavos).toBe(4_000);
    // 13:30Z = 10:30 BRT; 22:10Z = 19:10 BRT.
    expect(series).toHaveLength(24);
    expect(series[10]).toMatchObject({ label: "10h", grossCentavos: 10_000, netCentavos: 3_000, salesCount: 1 });
    expect(series[19]).toMatchObject({ label: "19h", grossCentavos: 5_000, salesCount: 1 });
    expect(series[0].grossCentavos).toBe(0);
  });

  test("aprovação de cartão ignora pendentes e conversão de Pix usa todos os gerados", () => {
    const rows = [
      row({ orderId: "card-ok", orderStatus: "approved", paymentStatus: "approved", approvedAt: new Date("2026-09-10T13:30:00.000Z") }),
      row({ orderId: "card-failed", orderStatus: "failed", paymentStatus: "failed" }),
      row({ orderId: "card-pending" }),
      row({ orderId: "pix-ok", provider: "mercadopago", paymentMethodId: "pix", paymentTypeId: "bank_transfer", orderStatus: "approved", paymentStatus: "approved", approvedAt: new Date("2026-09-10T14:00:00.000Z") }),
      row({ orderId: "pix-1", provider: "mercadopago", paymentMethodId: "pix", paymentTypeId: "bank_transfer" }),
      row({ orderId: "pix-2", provider: "mercadopago", paymentMethodId: "pix", paymentTypeId: "bank_transfer" }),
    ];
    const { summary } = buildProductSalesDashboard(rows, window);
    expect(summary.cardApproved).toBe(1);
    expect(summary.cardDecided).toBe(2);
    expect(summary.cardApprovalPercent).toBe(50);
    expect(summary.pixGenerated).toBe(3);
    expect(summary.pixApproved).toBe(1);
    expect(summary.pixConversionPercent).toBe(33.3);
    expect(summary.salesCount).toBe(2);
  });

  test("reembolso conta pelo dia do reembolso, chargeback pelo status do pagamento, e zera o líquido", () => {
    const rows = [
      row({ orderId: "sale", orderStatus: "approved", paymentStatus: "approved", approvedAt: new Date("2026-09-10T13:30:00.000Z") }),
      row({
        orderId: "refunded-today",
        orderStatus: "refunded",
        paymentStatus: "refunded",
        approvedAt: new Date("2026-09-10T12:00:00.000Z"),
        refundedAt: new Date("2026-09-10T16:00:00.000Z"),
        automatizeTotalNetRevenueCentavos: 0,
      }),
      // Aprovado semana passada, reembolsado hoje: entra só no reembolso.
      row({
        orderId: "refunded-old-sale",
        orderStatus: "refunded",
        paymentStatus: "refunded",
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
        approvedAt: new Date("2026-09-01T12:00:00.000Z"),
        refundedAt: new Date("2026-09-10T17:00:00.000Z"),
        automatizeTotalNetRevenueCentavos: 0,
      }),
      row({ orderId: "chargeback", orderStatus: "approved", paymentStatus: "charged_back", approvedAt: new Date("2026-09-10T15:00:00.000Z") }),
    ];
    const { summary } = buildProductSalesDashboard(rows, window);
    expect(summary.salesCount).toBe(3);
    expect(summary.grossCentavos).toBe(30_000);
    expect(summary.netCentavos).toBe(6_000);
    expect(summary.refundCount).toBe(2);
    expect(summary.refundPercent).toBe(66.7);
    expect(summary.chargebackCount).toBe(1);
    expect(summary.chargebackPercent).toBe(33.3);
  });

  test("sem dados, taxas ficam nulas e a série diária cobre o período inteiro", () => {
    const weekly = resolveProductSalesWindow({ from: "2026-09-04", to: "2026-09-10" }, NOW);
    const { summary, series } = buildProductSalesDashboard([], weekly);
    expect(summary.cardApprovalPercent).toBeNull();
    expect(summary.pixConversionPercent).toBeNull();
    expect(summary.refundPercent).toBeNull();
    expect(series.map((point) => point.label)).toEqual(["04/09", "05/09", "06/09", "07/09", "08/09", "09/09", "10/09"]);
  });
});

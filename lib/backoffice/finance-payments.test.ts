import { describe, expect, test } from "bun:test";
import {
  resolveAutomatizePaymentAmounts,
  resolveProductPaymentAmounts,
  summarizeAutomatizePayments,
  summarizeProductPayments,
  listAutomatizePaymentNetGaps,
} from "./finance-payments";

describe("finance payments summaries", () => {
  test("summarizes automatize payments with stripe settlement overrides", () => {
    const summary = summarizeAutomatizePayments(
      [
        {
          id: "p1",
          paidAt: new Date("2026-08-01T12:00:00Z"),
          userId: "u1",
          userEmail: "a@example.com",
          planType: "pro",
          provider: "stripe",
          amount: 10000,
          grossAmount: null,
          netAmount: null,
          feeAmount: null,
          currency: "brl",
          stripeInvoiceId: "inv_1",
          mercadopagoPaymentId: null,
          description: null,
        },
      ],
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
  });

  test("summarizes product payments using automatize net after expert share", () => {
    const summary = summarizeProductPayments([
      {
        id: "pp1",
        orderId: "o1",
        productTitle: "Curso expert",
        buyerName: "Maria",
        buyerEmail: "maria@example.com",
        approvedAt: new Date("2026-08-02T12:00:00Z"),
        createdAt: new Date("2026-08-02T11:00:00Z"),
        providerPaymentId: "123",
        grossAmountCentavos: 20000,
        netAmountCentavos: 19000,
        feeAmountCentavos: 1000,
        priceCentavos: 20000,
        ownerType: "expert",
        expertShareBasisPoints: 9000,
        expertRevenueCentavos: 17100,
      },
    ]);

    expect(summary.count).toBe(1);
    expect(summary.grossCentavos).toBe(20000);
    expect(summary.netCentavos).toBe(1900);
  });

  test("keeps full gateway net for automatize-owned products", () => {
    const amounts = resolveProductPaymentAmounts({
      id: "pp2",
      orderId: "o2",
      productTitle: "Curso Automatize",
      buyerName: "João",
      buyerEmail: "joao@example.com",
      approvedAt: new Date("2026-08-02T12:00:00Z"),
      createdAt: new Date("2026-08-02T11:00:00Z"),
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

  test("derives expert share from basis points when ledger is missing", () => {
    const amounts = resolveProductPaymentAmounts({
      id: "pp3",
      orderId: "o3",
      productTitle: "Curso expert",
      buyerName: "Ana",
      buyerEmail: "ana@example.com",
      approvedAt: new Date("2026-08-02T12:00:00Z"),
      createdAt: new Date("2026-08-02T11:00:00Z"),
      providerPaymentId: "789",
      grossAmountCentavos: 8799,
      netAmountCentavos: 8614,
      feeAmountCentavos: 185,
      priceCentavos: 8799,
      ownerType: "expert",
      expertShareBasisPoints: 9500,
      expertRevenueCentavos: null,
    });

    expect(amounts.revenueKind).toBe("taxa");
    expect(amounts.expertRevenueCentavos).toBe(8183);
    expect(amounts.automatizeNetCentavos).toBe(431);
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
          id: "p1",
          paidAt: new Date("2026-08-01T12:00:00Z"),
          userId: "u1",
          userEmail: "a@example.com",
          planType: "pro",
          provider: "mercadopago",
          amount: 9900,
          grossAmount: null,
          netAmount: null,
          feeAmount: null,
          currency: "brl",
          stripeInvoiceId: null,
          mercadopagoPaymentId: "12345",
          description: null,
        },
        {
          id: "p2",
          paidAt: new Date("2026-08-02T12:00:00Z"),
          userId: "u2",
          userEmail: "b@example.com",
          planType: "pro",
          provider: "stripe",
          amount: 10000,
          grossAmount: null,
          netAmount: null,
          feeAmount: null,
          currency: "brl",
          stripeInvoiceId: "inv_missing",
          mercadopagoPaymentId: null,
          description: null,
        },
      ],
      [],
    );

    expect(gaps).toHaveLength(2);
    expect(gaps[0]?.reason).toBe("mercadopago_fees_pending");
    expect(gaps[1]?.reason).toBe("stripe_settlement_unavailable");
  });
});

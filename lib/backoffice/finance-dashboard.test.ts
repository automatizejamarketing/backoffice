import { describe, expect, test } from "bun:test";
import { summarizeFinanceDashboard } from "./finance-dashboard";

describe("finance dashboard", () => {
  test("normalizes active plans into MRR and reconciles payment net amounts", () => {
    expect(
      summarizeFinanceDashboard(
        [
          { provider: "stripe", planType: "annual_starter" },
          { provider: "mercadopago", planType: "monthly_pro" },
          { provider: "manual", planType: "monthly_starter" },
        ],
        [
          {
            id: "card-payment",
            provider: "stripe",
            amount: 49_700,
            grossAmount: null,
            netAmount: null,
            feeAmount: null,
            stripeInvoiceId: "invoice-1",
          },
          {
            id: "pix-payment",
            provider: "mercadopago",
            amount: 29_700,
            grossAmount: 29_700,
            netAmount: 29_406,
            feeAmount: 294,
            stripeInvoiceId: null,
          },
        ],
        [
          {
            invoiceId: "invoice-1",
            grossAmount: 49_700,
            feeAmount: 2_022,
            netAmount: 47_678,
          },
        ],
        { grossCentavos: 238_200, payingCustomers: 3 },
      ),
    ).toEqual({
      mrrCentavos: 99_100,
      activeSubscriptions: 3,
      realizedLtvCentavos: 79_400,
      lifetimePayingCustomers: 3,
      mrrByProvider: { card: 19_700, pix: 49_700, manual: 29_700 },
      receipts: {
        payments: 2,
        grossCentavos: 79_400,
        feeCentavos: 2_316,
        netCentavos: 77_084,
        netCoveragePayments: 2,
        averageNetTicketCentavos: 38_542,
        providers: {
          card: {
            provider: "card",
            payments: 1,
            grossCentavos: 49_700,
            feeCentavos: 2_022,
            netCentavos: 47_678,
            netCoveragePayments: 1,
          },
          pix: {
            provider: "pix",
            payments: 1,
            grossCentavos: 29_700,
            feeCentavos: 294,
            netCentavos: 29_406,
            netCoveragePayments: 1,
          },
          manual: {
            provider: "manual",
            payments: 0,
            grossCentavos: 0,
            feeCentavos: 0,
            netCentavos: 0,
            netCoveragePayments: 0,
          },
        },
      },
    });
  });

  test("keeps unreconciled card gross out of confirmed net", () => {
    const result = summarizeFinanceDashboard(
      [],
      [
        {
          id: "unreconciled",
          provider: "stripe",
          amount: 29_700,
          grossAmount: null,
          netAmount: null,
          feeAmount: null,
          stripeInvoiceId: "missing-invoice",
        },
      ],
      [],
      { grossCentavos: 0, payingCustomers: 0 },
    );

    expect(result.receipts).toMatchObject({
      payments: 1,
      grossCentavos: 29_700,
      feeCentavos: 0,
      netCentavos: 0,
      netCoveragePayments: 0,
      averageNetTicketCentavos: 0,
    });
    expect(result.realizedLtvCentavos).toBe(0);
  });

  test("keeps historical Vindi receipts in totals and out of classified providers", () => {
    const result = summarizeFinanceDashboard(
      [
        {
          provider: "vindi",
          planType: "monthly_starter",
        },
        {
          provider: "vindi",
          planType: "monthly_pro",
        },
      ],
      [
        {
          id: "historical-card",
          provider: "vindi",
          amount: 29_700,
          grossAmount: 29_700,
          netAmount: 28_353,
          feeAmount: 1_347,
          stripeInvoiceId: null,
          paymentMethod: "credit_card",
          purpose: "subscription",
        },
        {
          id: "historical-pix",
          provider: "vindi",
          amount: 49_700,
          grossAmount: 49_700,
          netAmount: 49_406,
          feeAmount: 294,
          stripeInvoiceId: null,
          paymentMethod: "pix",
          purpose: "legacy_renewal",
        },
      ],
      [],
      { grossCentavos: 79_400, payingCustomers: 2 },
    );

    expect(result.activeSubscriptions).toBe(2);
    expect(result.mrrCentavos).toBe(79_400);
    expect(result.mrrByProvider).toEqual({
      card: 0,
      pix: 0,
      manual: 0,
    });
    expect(result.receipts.providers.card.payments).toBe(0);
    expect(result.receipts.providers.pix.payments).toBe(0);
    expect(result.receipts.providers.manual.payments).toBe(0);
    expect(result.receipts.payments).toBe(2);
    expect(result.receipts.grossCentavos).toBe(79_400);
    expect(result.receipts.netCentavos).toBe(77_759);
  });

  test("keeps store and pack rows out of billing receipt cards", () => {
    const result = summarizeFinanceDashboard(
      [],
      [
        {
          id: "subscription",
          provider: "stripe",
          amount: 29_700,
          grossAmount: 29_700,
          netAmount: 28_353,
          feeAmount: 1_347,
          stripeInvoiceId: null,
          paymentMethod: "credit_card",
          purpose: "subscription",
        },
        {
          id: "product",
          provider: "stripe",
          amount: 10_000,
          grossAmount: 10_000,
          netAmount: 9_451,
          feeAmount: 549,
          stripeInvoiceId: null,
          paymentMethod: "credit_card",
          purpose: "product",
        },
        {
          id: "pack",
          provider: "mercadopago",
          amount: 4_700,
          grossAmount: 4_700,
          netAmount: 4_700,
          feeAmount: 0,
          stripeInvoiceId: null,
          paymentMethod: "pix",
          purpose: "credit_pack",
        },
      ],
      [],
      { grossCentavos: 29_700, payingCustomers: 1 },
    );

    expect(result.receipts.payments).toBe(1);
    expect(result.receipts.grossCentavos).toBe(29_700);
    expect(result.receipts.providers.card.payments).toBe(1);
    expect(result.receipts.providers.pix.payments).toBe(0);
  });
});

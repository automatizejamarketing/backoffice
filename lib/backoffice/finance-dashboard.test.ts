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
      ),
    ).toEqual({
      mrrCentavos: 99_100,
      activeSubscriptions: 3,
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
    );

    expect(result.receipts).toMatchObject({
      payments: 1,
      grossCentavos: 29_700,
      feeCentavos: 0,
      netCentavos: 0,
      netCoveragePayments: 0,
      averageNetTicketCentavos: 0,
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  describeAutomatizePaymentSequence,
  describeProductPaymentProvider,
  resolveAutomatizePaymentAmounts,
  resolveProductPaymentAmounts,
  summarizeAutomatizePayments,
  summarizeProductPayments,
  listAutomatizePaymentNetGaps,
} from "./finance-payments";

const automatizePaymentFixture = {
  id: "p1",
  paidAt: new Date("2026-08-01T12:00:00Z"),
  createdAt: new Date("2026-08-01T12:00:00Z"),
  userId: "u1",
  userEmail: "a@example.com",
  planType: "pro" as const,
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
  platformFeeGrossCentavos: null,
  automatizeCoproductionRevenueCentavos: null,
  automatizeProductRevenueCentavos: null,
  automatizeTotalNetRevenueCentavos: null,
  expertShareBasisPoints: 9000,
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

import { describe, expect, test } from "bun:test";
import { isConfirmedCancellationRenewalPayment } from "@/lib/backoffice/cancellation-stats-correlation";

const asOf = new Date("2026-09-20T12:00:00.000Z");
const benefit = {
  id: "benefit-1",
  providerInvoiceId: "in_retention_1",
  providerPaymentId: "pi_retention_1",
};

function payment(overrides: Partial<Parameters<typeof isConfirmedCancellationRenewalPayment>[0]["payment"]> = {}) {
  return {
    userId: "user-1",
    subscriptionId: "sub-1",
    provider: "stripe",
    purpose: "subscription",
    status: "succeeded",
    paidAt: new Date("2026-09-11T12:00:00.000Z"),
    retentionBenefitId: null,
    stripeInvoiceId: "in_retention_1",
    stripePaymentIntentId: null,
    stripeChargeId: null,
    externalId: null,
    ...overrides,
  };
}

describe("admin cancellation stats payment correlation", () => {
  test("accepts Stripe renewal payment by retention invoice ID", () => {
    expect(
      isConfirmedCancellationRenewalPayment({
        provider: "stripe",
        subscriptionId: "sub-1",
        benefit,
        payment: payment(),
        asOf,
      }),
    ).toBe(true);
  });

  test("accepts Stripe renewal payment by provider payment ID", () => {
    expect(
      isConfirmedCancellationRenewalPayment({
        provider: "stripe",
        subscriptionId: "sub-1",
        benefit,
        payment: payment({
          stripeInvoiceId: null,
          externalId: "pi_retention_1",
        }),
        asOf,
      }),
    ).toBe(true);
  });

  test("accepts a succeeded PIX payment only when it names the retention benefit", () => {
    expect(
      isConfirmedCancellationRenewalPayment({
        provider: "mercadopago",
        subscriptionId: "sub-1",
        benefit,
        payment: payment({
          provider: "mercadopago",
          retentionBenefitId: "benefit-1",
          stripeInvoiceId: null,
        }),
        asOf,
      }),
    ).toBe(true);
    expect(
      isConfirmedCancellationRenewalPayment({
        provider: "mercadopago",
        subscriptionId: "sub-1",
        benefit,
        payment: payment({
          provider: "mercadopago",
          retentionBenefitId: "other-benefit",
          stripeInvoiceId: null,
        }),
        asOf,
      }),
    ).toBe(false);
  });

  test("rejects wrong-purpose, refunded, and future payments", () => {
    for (const overrides of [
      { purpose: "product" },
      { status: "refunded" },
      { paidAt: new Date("2026-09-20T12:00:00.001Z") },
    ]) {
      expect(
        isConfirmedCancellationRenewalPayment({
          provider: "stripe",
          subscriptionId: "sub-1",
          benefit,
          payment: payment(overrides),
          asOf,
        }),
      ).toBe(false);
    }
  });
});

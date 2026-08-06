import assert from "node:assert/strict";
import test from "node:test";
import {
  canCancelStripeSubscriptionAtPeriodEnd,
  getStripeCancellationExpirationDate,
} from "./stripe-subscription-cancel-policy";

const baseStripeSubscription = {
  id: "sub-db",
  planType: "monthly_pro" as const,
  status: "active" as const,
  currentPeriodEnd: new Date("2026-08-12T20:00:00.000Z"),
  cancelAtPeriodEnd: false,
  stripeSubscriptionId: "sub_stripe",
  provider: "stripe" as const,
};

test("canCancelStripeSubscriptionAtPeriodEnd allows active Stripe subscriptions", () => {
  assert.equal(
    canCancelStripeSubscriptionAtPeriodEnd(baseStripeSubscription),
    true,
  );
});

test("canCancelStripeSubscriptionAtPeriodEnd blocks Pix subscriptions", () => {
  assert.equal(
    canCancelStripeSubscriptionAtPeriodEnd({
      ...baseStripeSubscription,
      provider: "mercadopago",
      stripeSubscriptionId: null,
    }),
    false,
  );
});

test("canCancelStripeSubscriptionAtPeriodEnd blocks already scheduled cancellations", () => {
  assert.equal(
    canCancelStripeSubscriptionAtPeriodEnd({
      ...baseStripeSubscription,
      cancelAtPeriodEnd: true,
    }),
    false,
  );
});

test("getStripeCancellationExpirationDate returns current period end", () => {
  assert.equal(
    getStripeCancellationExpirationDate(baseStripeSubscription)?.toISOString(),
    "2026-08-12T20:00:00.000Z",
  );
});

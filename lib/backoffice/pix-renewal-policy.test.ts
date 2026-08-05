import assert from "node:assert/strict";
import test from "node:test";
import { getPixRenewalDisabledReason } from "./pix-renewal-policy";

test("getPixRenewalDisabledReason blocks active Stripe subscriptions", () => {
  assert.equal(
    getPixRenewalDisabledReason({
      id: "sub_1",
      planType: "monthly_pro",
      status: "active",
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: "sub_stripe",
      provider: "stripe",
    }),
    "Pix bloqueado: este usuário possui assinatura Stripe ativa.",
  );
});

test("getPixRenewalDisabledReason allows Mercado Pago subscriptions", () => {
  assert.equal(
    getPixRenewalDisabledReason({
      id: "sub_1",
      planType: "monthly_pro",
      status: "active",
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: null,
      provider: "mercadopago",
    }),
    null,
  );
});

test("getPixRenewalDisabledReason allows users without subscription", () => {
  assert.equal(getPixRenewalDisabledReason(null), null);
});

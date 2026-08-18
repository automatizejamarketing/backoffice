import assert from "node:assert/strict";
import test from "node:test";
import {
  getPixRenewalDisabledReason,
  subscriptionsBlockPixRenewal,
} from "./pix-renewal-policy";

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

test("getPixRenewalDisabledReason treats a null provider as Stripe", () => {
  assert.equal(
    getPixRenewalDisabledReason({
      id: "sub_1",
      planType: "monthly_pro",
      status: "active",
      currentPeriodEnd: new Date(),
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: "sub_stripe",
      provider: null,
    } as unknown as Parameters<typeof getPixRenewalDisabledReason>[0]),
    "Pix bloqueado: este usuário possui assinatura Stripe ativa.",
  );
});

test("subscriptionsBlockPixRenewal matches the UI policy for a live Stripe row", () => {
  assert.equal(
    subscriptionsBlockPixRenewal([
      {
        provider: null,
        status: "past_due",
      },
    ]),
    true,
  );
  assert.equal(
    subscriptionsBlockPixRenewal([
      {
        provider: "mercadopago",
        status: "active",
      },
    ]),
    false,
  );
});

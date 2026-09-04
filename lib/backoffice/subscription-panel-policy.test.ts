import assert from "node:assert/strict";
import test from "node:test";
import {
  billingProviderLabel,
  decideStripePaymentRecovery,
  decideSubscriptionPanelActions,
  providerExternalId,
} from "./subscription-panel-policy";

const stripeActive = {
  id: "sub-db",
  planType: "monthly_pro" as const,
  status: "active" as const,
  currentPeriodEnd: new Date("2026-08-12T20:00:00.000Z"),
  cancelAtPeriodEnd: false,
  stripeSubscriptionId: "sub_stripe",
  provider: "stripe" as const,
};

const failedStripePayment = {
  status: "failed" as const,
  stripeInvoiceId: "in_123",
  subscriptionId: "sub-db",
  amount: 29_700,
  currency: "brl",
  failureReason: "card_declined",
  createdAt: new Date("2026-08-01T12:00:00.000Z"),
};

test("billingProviderLabel names Stripe, Mercado Pago and manual without Vindi", () => {
  assert.equal(billingProviderLabel("stripe"), "Stripe/cartão");
  assert.equal(billingProviderLabel("mercadopago"), "Mercado Pago Pix");
  assert.equal(billingProviderLabel("manual"), "Manual");
  assert.equal(billingProviderLabel("vindi"), "sem classificação");
  assert.doesNotMatch(billingProviderLabel("vindi"), /vindi/i);
});

test("providerExternalId keeps a historical provider id so listings still resolve", () => {
  assert.equal(
    providerExternalId({
      provider: "vindi",
      historicalProviderId: "88002",
    }),
    "88002",
  );
  assert.equal(
    providerExternalId({
      provider: "stripe",
      stripeId: "in_123",
      historicalProviderId: "88002",
    }),
    "in_123",
  );
  assert.equal(
    providerExternalId({
      provider: "mercadopago",
      mercadopagoId: "12345",
    }),
    "12345",
  );
});

test("decideStripePaymentRecovery offers recovery for Assinante Stripe past_due with a failed invoice", () => {
  const recovery = decideStripePaymentRecovery({
    subscription: { ...stripeActive, status: "past_due" },
    payments: [failedStripePayment],
  });
  assert.equal(recovery?.invoiceId, "in_123");
  assert.equal(recovery?.amountCents, 29_700);
});

test("decideStripePaymentRecovery hides recovery when the Assinatura Viva is not Stripe", () => {
  assert.equal(
    decideStripePaymentRecovery({
      subscription: {
        ...stripeActive,
        provider: "vindi",
        status: "past_due",
      },
      payments: [failedStripePayment],
    }),
    null,
  );
});

test("decideStripePaymentRecovery hides recovery for an active Assinante Stripe", () => {
  assert.equal(
    decideStripePaymentRecovery({
      subscription: stripeActive,
      payments: [failedStripePayment],
    }),
    null,
  );
});

test("decideSubscriptionPanelActions keeps Stripe and Mercado Pago actions and never enables Vindi ones", () => {
  const stripePastDue = decideSubscriptionPanelActions({
    subscription: { ...stripeActive, status: "past_due" },
    payments: [failedStripePayment],
  });
  assert.equal(stripePastDue.stripeRecovery, true);
  assert.equal(stripePastDue.stripeCancel, true);
  assert.equal(stripePastDue.pixRenewalAllowed, false);

  const mercadoPago = decideSubscriptionPanelActions({
    subscription: {
      ...stripeActive,
      provider: "mercadopago",
      stripeSubscriptionId: null,
    },
    payments: [],
  });
  assert.equal(mercadoPago.stripeRecovery, false);
  assert.equal(mercadoPago.stripeCancel, false);
  assert.equal(mercadoPago.pixRenewalAllowed, true);

  const historical = decideSubscriptionPanelActions({
    subscription: {
      ...stripeActive,
      provider: "vindi",
      stripeSubscriptionId: null,
      status: "past_due",
    },
    payments: [
      {
        ...failedStripePayment,
        stripeInvoiceId: null,
      },
    ],
  });
  assert.equal(historical.stripeRecovery, false);
  assert.equal(historical.stripeCancel, false);
  assert.equal(historical.pixRenewalAllowed, true);
});

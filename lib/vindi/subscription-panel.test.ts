import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { presentBackofficeVindiSubscription } from "./subscription-panel";

const dueAt = new Date("2026-08-24T15:00:00.000Z");
const now = new Date("2026-08-17T15:00:00.000Z");

function vindiSub(overrides: Record<string, unknown> = {}) {
  return {
    provider: "vindi" as const,
    status: "active" as const,
    planType: "quarterly_starter" as const,
    vindiPaymentMethod: "credit_card" as const,
    vindiConsentStatus: null,
    vindiSubscriptionId: "sub_vindi_1",
    commitmentMonths: 3,
    currentPeriodEnd: dueAt,
    cancelAtPeriodEnd: false,
    stripeSubscriptionId: "sub_stripe_should_hide",
    stripePriceId: "price_should_hide",
    ...overrides,
  };
}

describe("presentBackofficeVindiSubscription", () => {
  it("labels Vindi, shows card installments, and hides Stripe ids", () => {
    const view = presentBackofficeVindiSubscription({
      subscription: vindiSub(),
      expirationDate: dueAt,
      failedPayment: null,
      now,
    });

    assert.equal(view?.providerLabel, "Vindi");
    assert.equal(view?.paymentMethodLabel, "Cartão");
    assert.equal(view?.installmentsLabel, "3×");
    assert.equal(view?.consentLabel, null);
    assert.equal(view?.vindiSubscriptionId, "sub_vindi_1");
    assert.equal(view?.showStripeIds, false);
    assert.equal(view?.profileTitle, "Usuário");
    assert.equal(view?.nextChargeAt?.toISOString(), dueAt.toISOString());
  });

  it("shows Pix Automático consent and hides installments", () => {
    const view = presentBackofficeVindiSubscription({
      subscription: vindiSub({
        vindiPaymentMethod: "pix_automatic",
        vindiConsentStatus: "authorized",
        commitmentMonths: 1,
        planType: "monthly_starter",
      }),
      expirationDate: dueAt,
      failedPayment: null,
      now,
    });

    assert.equal(view?.paymentMethodLabel, "Pix Automático");
    assert.equal(view?.consentLabel, "Autorizado");
    assert.equal(view?.installmentsLabel, null);
  });

  it("warns when cancel falls inside the Janela de Agendamento", () => {
    const view = presentBackofficeVindiSubscription({
      subscription: vindiSub({
        vindiPaymentMethod: "pix_automatic",
        vindiConsentStatus: "authorized",
        commitmentMonths: 1,
        planType: "monthly_starter",
      }),
      expirationDate: dueAt,
      failedPayment: null,
      now: new Date("2026-08-23T15:00:00.000Z"),
    });

    assert.equal(view?.cancel?.canCancel, true);
    assert.equal(view?.cancel?.mode, "cancel_requested");
    assert.equal(view?.cancel?.inSchedulingWindow, true);
    assert.equal(
      view?.cancel?.copy.inWindow,
      "A cobrança desta renovação já está agendada e será debitada. Seu acesso segue até o fim do novo período. O cancelamento será efetivado após o vencimento.",
    );
    assert.equal(
      view?.cancel?.copy.consentRemains,
      "O consentimento do Pix Automático continua registrado no seu banco. A revogação é feita no aplicativo do banco.",
    );
  });

  it("offers retry and Pix reissue for a past_due card charge", () => {
    const failedAt = new Date("2026-08-16T12:00:00.000Z");
    const view = presentBackofficeVindiSubscription({
      subscription: vindiSub({ status: "past_due" }),
      expirationDate: dueAt,
      failedPayment: {
        vindiChargeId: "88",
        vindiBillId: "16019800",
        amount: 80_100,
        currency: "brl",
        failureReason: "Saldo insuficiente.",
        createdAt: failedAt,
      },
      now,
    });

    assert.equal(view?.recovery?.chargeId, "88");
    assert.equal(view?.recovery?.retryAllowed, true);
    assert.equal(view?.recovery?.reissueAllowed, true);
    assert.equal(view?.recovery?.amountCents, 80_100);
    assert.equal(view?.recovery?.failureReason, "Saldo insuficiente.");
  });

  it("hides retry for Pix Automático and keeps the Pix reissue exit", () => {
    const view = presentBackofficeVindiSubscription({
      subscription: vindiSub({
        status: "past_due",
        vindiPaymentMethod: "pix_automatic",
        vindiConsentStatus: "authorized",
        commitmentMonths: 1,
        planType: "monthly_starter",
      }),
      expirationDate: dueAt,
      failedPayment: {
        vindiChargeId: "91",
        vindiBillId: "16019801",
        amount: 26_700,
        currency: "brl",
        failureReason: "Limite do Pix Automático excedido.",
        createdAt: now,
      },
      now,
    });

    assert.equal(view?.recovery?.retryAllowed, false);
    assert.equal(view?.recovery?.reissueAllowed, true);
  });

  it("keeps the Janela de Agendamento warning after the intent is registered", () => {
    const view = presentBackofficeVindiSubscription({
      subscription: vindiSub({
        vindiPaymentMethod: "pix_automatic",
        vindiConsentStatus: "authorized",
        commitmentMonths: 1,
        planType: "monthly_starter",
        cancelAtPeriodEnd: true,
      }),
      expirationDate: dueAt,
      failedPayment: null,
      now: new Date("2026-08-23T15:00:00.000Z"),
    });

    assert.equal(view?.cancel?.canCancel, false);
    assert.equal(view?.cancel?.inSchedulingWindow, true);
    assert.equal(
      view?.cancel?.copy.inWindow,
      "A cobrança desta renovação já está agendada e será debitada. Seu acesso segue até o fim do novo período. O cancelamento será efetivado após o vencimento.",
    );
  });

  it("does not present a Vindi view for a Stripe subscription", () => {
    const view = presentBackofficeVindiSubscription({
      subscription: vindiSub({ provider: "stripe" }),
      expirationDate: dueAt,
      failedPayment: null,
      now,
    });
    assert.equal(view, null);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideProductOrderRefund } from "./order-refund-policy";

const approvedMercadoPago = {
  status: "approved" as const,
  provider: "mercadopago",
  providerPaymentId: "mp-pay-100",
};

describe("decideProductOrderRefund", () => {
  it("refunds a Mercado Pago order at the gateway", () => {
    assert.deepEqual(decideProductOrderRefund(approvedMercadoPago), {
      ok: true,
      path: "mercadopago",
      paymentId: "mp-pay-100",
    });
  });

  it("reembolsa Stripe com Conta Stripe do Expert na conta conectada", () => {
    assert.deepEqual(
      decideProductOrderRefund({
        status: "approved",
        provider: "stripe",
        providerPaymentId: "pi_123",
        stripeAccountId: "acct_expert_123",
      }),
      {
        ok: true,
        path: "connected_account",
        stripeAccountId: "acct_expert_123",
        paymentIntentId: "pi_123",
      },
    );
  });

  it("records a manual refund for Stripe on the platform account", () => {
    assert.deepEqual(
      decideProductOrderRefund({
        status: "approved",
        provider: "stripe",
        providerPaymentId: "pi_123",
      }),
      { ok: true, path: "manual" },
    );
  });

  it("records a manual refund for a historical or unclassified provider", () => {
    assert.deepEqual(
      decideProductOrderRefund({
        status: "approved",
        provider: "vindi",
        providerPaymentId: "chg-9",
      }),
      { ok: true, path: "manual" },
    );
  });

  it("refuses an order that is not approved", () => {
    assert.deepEqual(
      decideProductOrderRefund({
        ...approvedMercadoPago,
        status: "pending",
      }),
      { ok: false, reason: "not_approved" },
    );
  });

  it("refuses an already refunded order", () => {
    assert.deepEqual(
      decideProductOrderRefund({
        ...approvedMercadoPago,
        status: "refunded",
      }),
      { ok: false, reason: "already_refunded" },
    );
  });

  it("refuses a Mercado Pago refund when the payment id is missing", () => {
    assert.deepEqual(
      decideProductOrderRefund({
        status: "approved",
        provider: "mercadopago",
        providerPaymentId: null,
      }),
      { ok: false, reason: "mercadopago_payment_missing" },
    );
  });

  it("refuses a Cobrança Direta refund when the payment intent is missing", () => {
    assert.deepEqual(
      decideProductOrderRefund({
        status: "approved",
        provider: "stripe",
        providerPaymentId: null,
        stripeAccountId: "acct_expert_123",
      }),
      { ok: false, reason: "stripe_payment_missing" },
    );
  });
});

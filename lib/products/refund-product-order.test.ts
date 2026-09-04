import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refundProductOrder } from "./refund-product-order";
import type { StripeConnectRefundClient } from "@/lib/stripe/connect/port";

type OrderState = {
  id: string;
  status: string;
  provider: string | null;
  providerPaymentId: string | null;
  stripeAccountId?: string | null;
  grossAmountCentavos?: number | null;
  priceCentavos?: number;
  automatizeCoproductionRevenueCentavos?: number | null;
};

function memoryStore(initial: OrderState) {
  let current = { ...initial };
  return {
    get current() {
      return current;
    },
    async recordRefund(orderId: string) {
      if (current.id !== orderId) throw new Error("pedido não encontrado");
      current = { ...current, status: "refunded" };
      return current;
    },
  };
}

function recordingMercadoPago() {
  const refundedPaymentIds: string[] = [];
  return {
    refundedPaymentIds,
    async refundPayment(paymentId: string) {
      refundedPaymentIds.push(paymentId);
    },
  };
}

function recordingStripeConnect() {
  const calls: Array<{
    params: {
      payment_intent: string;
      amount?: number;
      refund_application_fee?: boolean;
    };
    stripeAccount: string;
  }> = [];
  const client: StripeConnectRefundClient = {
    refunds: {
      create: async (params, options) => {
        calls.push({
          params,
          stripeAccount: options?.stripeAccount ?? "",
        });
        return { id: "re_test_123" };
      },
    },
  };
  return { client, calls };
}

const approvedMercadoPago: OrderState = {
  id: "order-mp",
  status: "approved",
  provider: "mercadopago",
  providerPaymentId: "mp-pay-100",
};

describe("refundProductOrder", () => {
  it("refunds a Mercado Pago Compra Avulsa at the gateway and records the reversal", async () => {
    const store = memoryStore(approvedMercadoPago);
    const mercadoPago = recordingMercadoPago();
    const stripeConnect = recordingStripeConnect();

    const result = await refundProductOrder({
      order: store.current,
      mercadoPago,
      stripeConnect: stripeConnect.client,
      store,
    });

    assert.deepEqual(result, {
      ok: true,
      path: "mercadopago",
      order: { ...approvedMercadoPago, status: "refunded" },
    });
    assert.deepEqual(mercadoPago.refundedPaymentIds, ["mp-pay-100"]);
    assert.equal(stripeConnect.calls.length, 0);
  });

  it("cria reembolso na conta conectada com refund_application_fee proporcional", async () => {
    const store = memoryStore({
      id: "order-connect",
      status: "approved",
      provider: "stripe",
      providerPaymentId: "pi_connect",
      stripeAccountId: "acct_expert_123",
      grossAmountCentavos: 10_000,
      automatizeCoproductionRevenueCentavos: 2_868,
    });
    const mercadoPago = recordingMercadoPago();
    const stripeConnect = recordingStripeConnect();

    const result = await refundProductOrder({
      order: store.current,
      mercadoPago,
      stripeConnect: stripeConnect.client,
      store,
      refundAmountCentavos: 5_000,
    });

    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected refund");
    assert.equal(result.path, "connected_account");
    assert.deepEqual(stripeConnect.calls, [
      {
        params: {
          payment_intent: "pi_connect",
          amount: 5_000,
          refund_application_fee: true,
        },
        stripeAccount: "acct_expert_123",
      },
    ]);
  });

  it("cria reembolso total na conta conectada sem amount parcial", async () => {
    const store = memoryStore({
      id: "order-connect-full",
      status: "approved",
      provider: "stripe",
      providerPaymentId: "pi_full",
      stripeAccountId: "acct_expert_456",
      grossAmountCentavos: 10_000,
      automatizeCoproductionRevenueCentavos: 0,
    });
    const stripeConnect = recordingStripeConnect();

    const result = await refundProductOrder({
      order: store.current,
      mercadoPago: recordingMercadoPago(),
      stripeConnect: stripeConnect.client,
      store,
    });

    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected refund");
    assert.deepEqual(stripeConnect.calls, [
      {
        params: { payment_intent: "pi_full" },
        stripeAccount: "acct_expert_456",
      },
    ]);
  });

  it("records a manual refund without calling Mercado Pago", async () => {
    const store = memoryStore({
      id: "order-card",
      status: "approved",
      provider: "stripe",
      providerPaymentId: "pi_123",
    });
    const mercadoPago = recordingMercadoPago();
    const stripeConnect = recordingStripeConnect();

    const result = await refundProductOrder({
      order: store.current,
      mercadoPago,
      stripeConnect: stripeConnect.client,
      store,
    });

    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected a refund");
    assert.equal(result.path, "manual");
    assert.equal(result.order.status, "refunded");
    assert.deepEqual(mercadoPago.refundedPaymentIds, []);
    assert.equal(stripeConnect.calls.length, 0);
  });

  it("leaves the order unchanged when Mercado Pago refuses the refund", async () => {
    const store = memoryStore(approvedMercadoPago);
    const result = await refundProductOrder({
      order: store.current,
      mercadoPago: {
        async refundPayment() {
          throw new Error("Mercado Pago recusou o reembolso (400)");
        },
      },
      stripeConnect: recordingStripeConnect().client,
      store,
    });

    assert.deepEqual(result, {
      ok: false,
      reason: "gateway_rejected",
      message: "Mercado Pago recusou o reembolso (400)",
    });
    assert.equal(store.current.status, "approved");
  });

  it("does not refund an order that is not approved", async () => {
    const store = memoryStore({
      ...approvedMercadoPago,
      status: "pending",
    });
    const mercadoPago = recordingMercadoPago();

    const result = await refundProductOrder({
      order: store.current,
      mercadoPago,
      stripeConnect: recordingStripeConnect().client,
      store,
    });

    assert.deepEqual(result, { ok: false, reason: "not_approved" });
    assert.equal(store.current.status, "pending");
    assert.deepEqual(mercadoPago.refundedPaymentIds, []);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refundProductOrder } from "./refund-product-order";

type OrderState = {
  id: string;
  status: string;
  provider: string | null;
  providerPaymentId: string | null;
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

    const result = await refundProductOrder({
      order: store.current,
      mercadoPago,
      store,
    });

    assert.deepEqual(result, {
      ok: true,
      path: "mercadopago",
      order: { ...approvedMercadoPago, status: "refunded" },
    });
    assert.deepEqual(mercadoPago.refundedPaymentIds, ["mp-pay-100"]);
  });

  it("records a manual refund without calling Mercado Pago", async () => {
    const store = memoryStore({
      id: "order-card",
      status: "approved",
      provider: "stripe",
      providerPaymentId: "pi_123",
    });
    const mercadoPago = recordingMercadoPago();

    const result = await refundProductOrder({
      order: store.current,
      mercadoPago,
      store,
    });

    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected a refund");
    assert.equal(result.path, "manual");
    assert.equal(result.order.status, "refunded");
    assert.deepEqual(mercadoPago.refundedPaymentIds, []);
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
      store,
    });

    assert.deepEqual(result, { ok: false, reason: "not_approved" });
    assert.equal(store.current.status, "pending");
    assert.deepEqual(mercadoPago.refundedPaymentIds, []);
  });
});

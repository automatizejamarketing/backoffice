import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VindiApiError, type VindiClient, type VindiRequest } from "./client";
import {
  decideVindiPaymentRefund,
  refundVindiPayment,
  VINDI_REFUND_ACTION,
  type VindiRefundablePayment,
  type VindiRefundStore,
} from "./refund";

const paidVindiPayment: VindiRefundablePayment = {
  id: "3b6f2f4e-6f3f-4f6f-9f3f-000000000001",
  userId: "7e20d60e-3afd-4df3-a026-00b7271ef167",
  provider: "vindi",
  status: "succeeded",
  purpose: "subscription",
  vindiChargeId: "99001",
  amount: 80100,
  currency: "brl",
};

function recordingClient(
  handler: (request: VindiRequest) => unknown,
): { client: VindiClient; calls: VindiRequest[] } {
  const calls: VindiRequest[] = [];
  return {
    calls,
    client: {
      async request<T>(request: VindiRequest) {
        calls.push(request);
        return handler(request) as T;
      },
    },
  };
}

function memoryStore(payment: VindiRefundablePayment | null) {
  const marked: Array<{ paymentId: string; refundedAmount: number; now: Date }> =
    [];
  const audits: Array<{ action: string; oldValue: string | null; note: string | null }> =
    [];
  const store: VindiRefundStore = {
    async getPayment() {
      return payment;
    },
    async markRefunded(input) {
      marked.push(input);
    },
    async writeAudit(entry) {
      audits.push(entry);
    },
  };
  return { store, marked, audits };
}

describe("decideVindiPaymentRefund", () => {
  it("aceita pagamento Vindi pago com charge id", () => {
    assert.deepEqual(decideVindiPaymentRefund(paidVindiPayment), {
      ok: true,
      chargeId: "99001",
    });
  });

  it("recusa provedores que não são Vindi", () => {
    assert.deepEqual(
      decideVindiPaymentRefund({ ...paidVindiPayment, provider: "stripe" }),
      { ok: false, reason: "not_vindi" },
    );
  });

  it("manda pagamento de produto para a aba Produtos", () => {
    assert.deepEqual(
      decideVindiPaymentRefund({ ...paidVindiPayment, purpose: "product" }),
      { ok: false, reason: "product_payment" },
    );
  });

  it("não estorna duas vezes", () => {
    assert.deepEqual(
      decideVindiPaymentRefund({ ...paidVindiPayment, status: "refunded" }),
      { ok: false, reason: "already_refunded" },
    );
  });

  it("só estorna pagamento efetuado", () => {
    for (const status of ["failed", "pending"] as const) {
      assert.deepEqual(
        decideVindiPaymentRefund({ ...paidVindiPayment, status }),
        { ok: false, reason: "not_paid" },
      );
    }
  });

  it("exige o charge id da Vindi", () => {
    assert.deepEqual(
      decideVindiPaymentRefund({ ...paidVindiPayment, vindiChargeId: null }),
      { ok: false, reason: "no_charge_id" },
    );
  });
});

describe("refundVindiPayment", () => {
  it("estorna o valor total, marca a linha e audita", async () => {
    const { client, calls } = recordingClient((request) => {
      assert.equal(request.method, "POST");
      assert.equal(request.path, "/v1/charges/99001/refund");
      assert.equal(request.body, undefined);
      return { charge: { id: 99001, status: "refunded" } };
    });
    const { store, marked, audits } = memoryStore(paidVindiPayment);
    const now = new Date("2026-08-21T15:00:00.000Z");

    const result = await refundVindiPayment({
      client,
      store,
      userId: paidVindiPayment.userId,
      paymentId: paidVindiPayment.id,
      adminEmail: "admin@example.com",
      now,
    });

    assert.deepEqual(result, {
      ok: true,
      chargeId: "99001",
      chargeStatus: "refunded",
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(marked, [
      { paymentId: paidVindiPayment.id, refundedAmount: 80100, now },
    ]);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.action, VINDI_REFUND_ACTION);
    assert.equal(audits[0]!.oldValue, "succeeded");
    assert.ok(audits[0]!.note?.includes("99001"));
  });

  it("não marca nada quando a Vindi recusa o estorno", async () => {
    const { client } = recordingClient(() => {
      // ex.: conta sem saldo disponível no intermediador
      throw new VindiApiError(422, [
        { id: "invalid_parameter", message: "Saldo insuficiente" },
      ]);
    });
    const { store, marked, audits } = memoryStore(paidVindiPayment);

    await assert.rejects(
      refundVindiPayment({
        client,
        store,
        userId: paidVindiPayment.userId,
        paymentId: paidVindiPayment.id,
        adminEmail: "admin@example.com",
        now: new Date(),
      }),
      (error: unknown) =>
        error instanceof VindiApiError && error.status === 422,
    );
    assert.equal(marked.length, 0);
    assert.equal(audits.length, 0);
  });

  it("não estorna pagamento de outro usuário", async () => {
    const { client, calls } = recordingClient(() => {
      throw new Error("Vindi must not be called");
    });
    const { store } = memoryStore(paidVindiPayment);

    const result = await refundVindiPayment({
      client,
      store,
      userId: "00000000-0000-0000-0000-000000000000",
      paymentId: paidVindiPayment.id,
      adminEmail: "admin@example.com",
      now: new Date(),
    });

    assert.deepEqual(result, { ok: false, error: "payment_not_found" });
    assert.equal(calls.length, 0);
  });

  it("propaga a razão da decisão sem chamar a Vindi", async () => {
    const { client, calls } = recordingClient(() => {
      throw new Error("Vindi must not be called");
    });
    const { store } = memoryStore({ ...paidVindiPayment, status: "pending" });

    const result = await refundVindiPayment({
      client,
      store,
      userId: paidVindiPayment.userId,
      paymentId: paidVindiPayment.id,
      adminEmail: "admin@example.com",
      now: new Date(),
    });

    assert.deepEqual(result, { ok: false, error: "not_paid" });
    assert.equal(calls.length, 0);
  });
});

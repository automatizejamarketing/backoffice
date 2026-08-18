import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VindiClient, VindiRequest } from "./client";
import pixRecorrenciaCharge from "./fixtures/pix-recorrencia-charge.json";
import {
  recoverVindiPayment,
  VINDI_RECOVERY_REISSUE_ACTION,
  VINDI_RECOVERY_RETRY_ACTION,
  type VindiBackofficeRecoveryStore,
  type VindiBackofficeRecoverySnapshot,
} from "./recovery-charge";

const USER_ID = "7e20d60e-3afd-4df3-a026-00b7271ef167";
const SANDBOX_EMV =
  pixRecorrenciaCharge.last_transaction.gateway_response_fields
    .qrcode_original_path;
const now = new Date("2026-08-17T15:00:00.000Z");

type RecordedAudit = {
  action: string;
  adminEmail: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string;
  note: string | null;
};

function recordingClient(
  handler: (request: VindiRequest) => unknown,
): { client: VindiClient; calls: VindiRequest[] } {
  const calls: VindiRequest[] = [];
  return {
    calls,
    client: {
      async request<T>(input: VindiRequest): Promise<T> {
        calls.push(input);
        return handler(input) as T;
      },
    },
  };
}

function cardSnapshot(
  overrides: Partial<VindiBackofficeRecoverySnapshot> = {},
): VindiBackofficeRecoverySnapshot {
  return {
    userId: USER_ID,
    subscription: {
      id: "sub-1",
      provider: "vindi",
      status: "past_due",
      planType: "quarterly_starter",
      vindiPaymentMethod: "credit_card",
    },
    failedPayment: {
      vindiChargeId: "88",
      vindiBillId: "16019800",
      amount: 80_100,
      currency: "brl",
      failureReason: "Saldo insuficiente.",
      createdAt: now,
    },
    pendingRecoveryLink: null,
    ...overrides,
  };
}

function memoryRecoveryStore(
  snapshot: VindiBackofficeRecoverySnapshot,
): VindiBackofficeRecoveryStore & {
  snapshot: VindiBackofficeRecoverySnapshot;
  audits: RecordedAudit[];
} {
  const store = {
    snapshot,
    audits: [] as RecordedAudit[],
    async getSnapshot() {
      return store.snapshot;
    },
    async persistRecoveryLink(input: Parameters<
      VindiBackofficeRecoveryStore["persistRecoveryLink"]
    >[0]) {
      const link = {
        id: "link-recovery-1",
        emvPayload: input.emvPayload,
        vindiBillId: input.vindiBillId,
        vindiChargeId: input.vindiChargeId,
        amount: input.amount,
        expiresAt: input.expiresAt,
      };
      store.snapshot.pendingRecoveryLink = link;
      return link;
    },
    async writeAudit(entry: Parameters<
      VindiBackofficeRecoveryStore["writeAudit"]
    >[0]) {
      store.audits.push(entry);
    },
  };
  return store;
}

describe("recoverVindiPayment", () => {
  it("returns user_not_found when the store has no snapshot", async () => {
    const { client } = recordingClient(() => {
      throw new Error("Vindi must not be called");
    });
    const result = await recoverVindiPayment({
      client,
      store: {
        async getSnapshot() {
          return null;
        },
        async persistRecoveryLink() {
          throw new Error("must not persist");
        },
        async writeAudit() {},
      },
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      mode: "retry",
      pixMethodCode: "pix",
      now,
    });
    assert.deepEqual(result, { ok: false, error: "user_not_found" });
  });

  it("retries a card charge and writes a recover audit line", async () => {
    const { client, calls } = recordingClient((request) => {
      if (request.method === "POST" && request.path === "/v1/charges/88/charge") {
        return { charge: { id: 88, status: "pending" } };
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    });
    const store = memoryRecoveryStore(cardSnapshot());

    const result = await recoverVindiPayment({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      mode: "retry",
      pixMethodCode: "pix",
      now,
    });

    assert.equal(result.ok, true);
    if (!result.ok || result.mode !== "retry") return;
    assert.equal(result.chargeStatus, "pending");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.path, "/v1/charges/88/charge");
    assert.equal(store.audits[0]?.action, VINDI_RECOVERY_RETRY_ACTION);
    assert.equal(store.audits[0]?.adminEmail, "admin@automatize.com");
  });

  it("refuses retry for Pix Automático without calling Vindi", async () => {
    const { client, calls } = recordingClient(() => {
      throw new Error("Vindi must not be called");
    });
    const result = await recoverVindiPayment({
      client,
      store: memoryRecoveryStore(
        cardSnapshot({
          subscription: {
            id: "sub-1",
            provider: "vindi",
            status: "past_due",
            planType: "monthly_starter",
            vindiPaymentMethod: "pix_automatic",
          },
        }),
      ),
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      mode: "retry",
      pixMethodCode: "pix",
      now,
    });

    assert.deepEqual(result, { ok: false, error: "retry_not_allowed" });
    assert.equal(calls.length, 0);
  });

  it("reissues the failed invoice as Pix and persists a recovery link", async () => {
    const { client, calls } = recordingClient((request) => {
      if (
        request.method === "POST" &&
        request.path === "/v1/charges/88/reissue"
      ) {
        return {
          charge: {
            ...pixRecorrenciaCharge,
            id: 88002,
            amount: "801.00",
            bill: { id: 16019800 },
          },
        };
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    });
    const store = memoryRecoveryStore(cardSnapshot());

    const result = await recoverVindiPayment({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      mode: "reissue",
      pixMethodCode: "pix",
      now,
    });

    assert.equal(result.ok, true);
    if (!result.ok || result.mode !== "reissue") return;
    assert.equal(result.reused, false);
    assert.equal(result.emvPayload, SANDBOX_EMV);
    assert.equal(result.amountCentavos, 80_100);
    assert.equal(store.snapshot.pendingRecoveryLink?.emvPayload, SANDBOX_EMV);
    assert.equal(store.snapshot.pendingRecoveryLink?.vindiChargeId, "88002");
    assert.deepEqual(calls[0], {
      method: "POST",
      path: "/v1/charges/88/reissue",
      body: { payment_method_code: "pix" },
    });
    assert.equal(store.audits[0]?.action, VINDI_RECOVERY_REISSUE_ACTION);
  });

  it("does not reuse a pending Pix that belongs to another invoice", async () => {
    const { client, calls } = recordingClient((request) => {
      if (
        request.method === "POST" &&
        request.path === "/v1/charges/88/reissue"
      ) {
        return {
          charge: {
            ...pixRecorrenciaCharge,
            id: 88002,
            amount: "801.00",
            bill: { id: 16019800 },
          },
        };
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    });
    const store = memoryRecoveryStore(
      cardSnapshot({
        pendingRecoveryLink: {
          id: "link-other",
          emvPayload: SANDBOX_EMV,
          vindiBillId: "9999",
          vindiChargeId: "77",
          amount: 26_700,
          expiresAt: new Date("2026-08-20T15:00:00.000Z"),
        },
      }),
    );

    const result = await recoverVindiPayment({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      mode: "reissue",
      pixMethodCode: "pix",
      now,
    });

    assert.equal(result.ok, true);
    if (!result.ok || result.mode !== "reissue") return;
    assert.equal(result.reused, false);
    assert.equal(calls[0]?.path, "/v1/charges/88/reissue");
  });

  it("reuses a pending recovery Pix of the same invoice instead of reissuing again", async () => {
    const { client, calls } = recordingClient(() => {
      throw new Error("Vindi must not be called");
    });
    const expiresAt = new Date("2026-08-20T15:00:00.000Z");
    const result = await recoverVindiPayment({
      client,
      store: memoryRecoveryStore(
        cardSnapshot({
          pendingRecoveryLink: {
            id: "link-existing",
            emvPayload: SANDBOX_EMV,
            vindiBillId: "16019800",
            vindiChargeId: "88002",
            amount: 80_100,
            expiresAt,
          },
        }),
      ),
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      mode: "reissue",
      pixMethodCode: "pix",
      now,
    });

    assert.equal(result.ok, true);
    if (!result.ok || result.mode !== "reissue") return;
    assert.equal(result.reused, true);
    assert.equal(result.emvPayload, SANDBOX_EMV);
    assert.equal(calls.length, 0);
  });
});

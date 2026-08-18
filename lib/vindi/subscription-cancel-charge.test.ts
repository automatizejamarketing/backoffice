import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VindiApiError, type VindiClient, type VindiRequest } from "./client";
import {
  cancelVindiSubscription,
  VINDI_CANCEL_AUDIT_ACTION,
  type VindiBackofficeCancelStore,
  type VindiBackofficeCancelSnapshot,
} from "./subscription-cancel-charge";

const USER_ID = "7e20d60e-3afd-4df3-a026-00b7271ef167";
const dueAt = new Date("2026-08-24T15:00:00.000Z");
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

function memoryCancelStore(
  snapshot: VindiBackofficeCancelSnapshot,
): VindiBackofficeCancelStore & {
  snapshot: VindiBackofficeCancelSnapshot;
  audits: RecordedAudit[];
  events: Array<{ eventType: string; metadata: Record<string, unknown> }>;
  superseded: string[];
  pendingChangesCanceled: boolean;
} {
  const store: VindiBackofficeCancelStore & {
    snapshot: VindiBackofficeCancelSnapshot;
    audits: RecordedAudit[];
    events: Array<{ eventType: string; metadata: Record<string, unknown> }>;
    superseded: string[];
    pendingChangesCanceled: boolean;
  } = {
    snapshot,
    audits: [],
    events: [],
    superseded: [],
    pendingChangesCanceled: false,
    async getSnapshot() {
      return store.snapshot;
    },
    async applyPaidCancel(input) {
      if (!store.snapshot.subscription) return;
      store.snapshot.subscription = {
        ...store.snapshot.subscription,
        status: input.effects.status,
        cancelAtPeriodEnd: input.effects.cancelAtPeriodEnd,
      };
    },
    async applyTrialCancel(input) {
      if (!store.snapshot.subscription) return;
      store.snapshot.subscription = {
        ...store.snapshot.subscription,
        status: "canceled",
        cancelAtPeriodEnd: false,
      };
      store.snapshot.expirationDate = input.now;
    },
    async cancelPendingPlanChanges() {
      store.pendingChangesCanceled = true;
    },
    async markLinksSuperseded(ids) {
      store.superseded.push(...ids);
      store.snapshot.openLinks = store.snapshot.openLinks.map((link) =>
        ids.includes(link.id) ? { ...link, status: "superseded" } : link,
      );
    },
    async writeEvent(entry) {
      store.events.push({
        eventType: entry.eventType,
        metadata: entry.metadata,
      });
    },
    async writeAudit(entry) {
      store.audits.push(entry);
    },
  };
  return store;
}

function paidCardSnapshot(
  overrides: Partial<VindiBackofficeCancelSnapshot["subscription"]> = {},
): VindiBackofficeCancelSnapshot {
  return {
    userId: USER_ID,
    expirationDate: dueAt,
    subscription: {
      id: "sub-1",
      provider: "vindi",
      status: "active",
      planType: "quarterly_starter",
      vindiPaymentMethod: "credit_card",
      vindiSubscriptionId: "4411",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: dueAt,
      currentPeriodStart: new Date("2026-05-24T15:00:00.000Z"),
      vindiConsentAuthorizedAt: null,
      ...overrides,
    },
    openLinks: [
      { id: "link-1", vindiBillId: "1599", status: "pending" },
    ],
  };
}

describe("cancelVindiSubscription", () => {
  it("DELETEs a card subscription immediately, supersedes open links, and audits", async () => {
    const { client, calls } = recordingClient((request) => {
      if (request.method === "DELETE") return undefined;
      throw new Error(`unexpected ${request.method} ${request.path}`);
    });
    const store = memoryCancelStore(paidCardSnapshot());

    const result = await cancelVindiSubscription({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      now,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mode, "immediate");
    assert.equal(store.snapshot.subscription?.status, "canceled");
    assert.equal(store.pendingChangesCanceled, true);
    assert.deepEqual(store.superseded, ["link-1"]);
    assert.equal(
      calls.some(
        (call) =>
          call.method === "DELETE" && call.path === "/v1/subscriptions/4411",
      ),
      true,
    );
    assert.equal(
      calls.some(
        (call) => call.method === "DELETE" && call.path === "/v1/bills/1599",
      ),
      true,
    );
    assert.equal(store.events[0]?.eventType, "canceled");
    assert.equal(store.audits[0]?.action, VINDI_CANCEL_AUDIT_ACTION);
    assert.equal(store.audits[0]?.adminEmail, "admin@automatize.com");
  });

  it("registers cancel_requested inside the Janela de Agendamento without deleting the subscription", async () => {
    const { client, calls } = recordingClient((request) => {
      if (request.method === "DELETE" && request.path.startsWith("/v1/bills/")) {
        return undefined;
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    });
    const store = memoryCancelStore(
      paidCardSnapshot({
        vindiPaymentMethod: "pix_automatic",
        planType: "monthly_starter",
      }),
    );

    const result = await cancelVindiSubscription({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      now: new Date("2026-08-23T15:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mode, "cancel_requested");
    assert.equal(result.inSchedulingWindow, true);
    assert.equal(store.snapshot.subscription?.status, "active");
    assert.equal(store.snapshot.subscription?.cancelAtPeriodEnd, true);
    assert.equal(
      calls.some((call) => call.path.startsWith("/v1/subscriptions/")),
      false,
    );
    assert.equal(store.audits[0]?.action, VINDI_CANCEL_AUDIT_ACTION);
    assert.match(store.audits[0]?.note ?? "", /janela/i);
  });

  it("cancels a logical Pix QR subscription only internally", async () => {
    const { client, calls } = recordingClient((request) => {
      if (request.method === "DELETE" && request.path.startsWith("/v1/bills/")) {
        return undefined;
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    });
    const store = memoryCancelStore(
      paidCardSnapshot({
        vindiPaymentMethod: "pix_qr",
        vindiSubscriptionId: null,
        planType: "quarterly_starter",
      }),
    );

    const result = await cancelVindiSubscription({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      now,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mode, "internal_only");
    assert.equal(store.snapshot.subscription?.status, "canceled");
    assert.equal(
      calls.some((call) => call.path.startsWith("/v1/subscriptions/")),
      false,
    );
  });

  it("revokes trial access immediately", async () => {
    const { client } = recordingClient((request) => {
      if (request.method === "DELETE") return undefined;
      throw new Error(`unexpected ${request.method} ${request.path}`);
    });
    const store = memoryCancelStore(
      paidCardSnapshot({
        status: "trialing",
        planType: "monthly_starter",
      }),
    );

    const result = await cancelVindiSubscription({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      now,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.mode, "immediate");
    assert.equal(store.snapshot.subscription?.status, "canceled");
    assert.equal(store.snapshot.expirationDate?.toISOString(), now.toISOString());
  });

  it("treats a missing Vindi subscription as already canceled", async () => {
    const { client } = recordingClient((request) => {
      if (request.method === "DELETE") {
        throw new VindiApiError(404, [
          { id: "not_found", message: "Subscription not found" },
        ]);
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    });
    const store = memoryCancelStore(paidCardSnapshot());

    const result = await cancelVindiSubscription({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      now,
    });
    assert.equal(result.ok, true);
  });

  it("refuses when there is no cancelable Vindi subscription", async () => {
    const { client } = recordingClient(() => {
      throw new Error("Vindi must not be called");
    });
    const result = await cancelVindiSubscription({
      client,
      store: memoryCancelStore({
        userId: USER_ID,
        expirationDate: dueAt,
        subscription: {
          id: "sub-1",
          provider: "stripe",
          status: "active",
          planType: "monthly_starter",
          vindiPaymentMethod: null,
          vindiSubscriptionId: null,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: dueAt,
          currentPeriodStart: now,
          vindiConsentAuthorizedAt: null,
        },
        openLinks: [],
      }),
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      now,
    });
    assert.deepEqual(result, { ok: false, error: "no_vindi_subscription" });
  });
});

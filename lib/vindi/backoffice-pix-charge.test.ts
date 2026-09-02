import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BackofficePixStripeBlockError } from "@/lib/backoffice/pix-renewal-policy";
import { VindiApiError, type VindiClient, type VindiRequest } from "./client";
import {
  createOrReuseBackofficeVindiPix,
  type BackofficeVindiPixStore,
  type StoredBackofficeVindiPixLink,
} from "./backoffice-pix-charge";
import type { VindiCustomerDirectory } from "./customer-lookup";
import pixRecorrenciaCharge from "./fixtures/pix-recorrencia-charge.json";
import {
  markVindiPaidOutOfBand,
  type VindiPaidOutOfBandStore,
} from "./paid-out-of-band";

const USER_ID = "7e20d60e-3afd-4df3-a026-00b7271ef167";
const EMV =
  pixRecorrenciaCharge.last_transaction.gateway_response_fields
    .qrcode_original_path;
const now = new Date("2026-08-17T15:00:00.000Z");

/** Um Cliente Vindi por par (Conta, CPF) — ADR 0029 no frontend. */
function memoryCustomers(
  seed: Record<string, string> = {},
): VindiCustomerDirectory {
  const links = Object.entries(seed).map(([userId, vindiCustomerId]) => ({
    userId,
    vindiCustomerId,
    vindiCode: userId,
    registryCode: null as string | null,
    isPrimary: true,
  }));
  return {
    async getPrimary(userId) {
      const found = links.find((row) => row.userId === userId && row.isPrimary);
      return found
        ? {
            vindiCustomerId: found.vindiCustomerId,
            registryCode: found.registryCode,
          }
        : null;
    },
    async findByRegistryCode(userId, registryCode) {
      const found = links.find(
        (row) => row.userId === userId && row.registryCode === registryCode,
      );
      return found
        ? {
            vindiCustomerId: found.vindiCustomerId,
            registryCode: found.registryCode,
          }
        : null;
    },
    async saveCustomer(input) {
      const existing = links.find(
        (row) => row.vindiCustomerId === input.vindiCustomerId,
      );
      if (existing) {
        Object.assign(existing, input);
        return;
      }
      links.push({ ...input });
    },
  };
}

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

function pixBillResponse(id: number) {
  return {
    bill: {
      id,
      amount: "801.00",
      status: "pending",
      charges: [{ ...pixRecorrenciaCharge, id: id + 100, amount: "801.00" }],
    },
  };
}

function defaultVindiHandler(request: VindiRequest): unknown {
  if (request.method === "GET" && request.path.includes("/v1/products")) {
    return { products: [{ id: 31012, code: "quarterly_starter" }] };
  }
  if (request.method === "POST" && request.path === "/v1/bills") {
    return pixBillResponse(16020000);
  }
  if (request.method === "DELETE" && request.path.startsWith("/v1/bills/")) {
    return undefined;
  }
  throw new Error(`unexpected ${request.method} ${request.path}`);
}

function memoryPixStore(
  seed: StoredBackofficeVindiPixLink[] = [],
): BackofficeVindiPixStore & { links: StoredBackofficeVindiPixLink[] } {
  const links = [...seed];
  return {
    links,
    async listOpenLinks() {
      return links.filter((link) => link.status === "pending");
    },
    async persistLink(input) {
      const created: StoredBackofficeVindiPixLink = {
        id: `link-${links.length + 1}`,
        userId: input.userId,
        planType: input.planType,
        amount: input.amount,
        currency: "brl",
        emvPayload: input.emvPayload,
        vindiBillId: input.vindiBillId,
        vindiChargeId: input.vindiChargeId,
        status: "pending",
        source: "backoffice",
        expiresAt: input.expiresAt,
        createdAt: input.now,
      };
      links.push(created);
      return created;
    },
    async markLinksSuperseded(ids, at) {
      for (const link of links) {
        if (ids.includes(link.id)) {
          link.status = "superseded";
          link.updatedAt = at;
        }
      }
    },
  };
}

describe("createOrReuseBackofficeVindiPix", () => {
  it("creates a standalone Pix bill and persists the EMV copia-e-cola", async () => {
    const { client, calls } = recordingClient(defaultVindiHandler);
    const store = memoryPixStore();

    const result = await createOrReuseBackofficeVindiPix({
      client,
      customers: memoryCustomers({ [USER_ID]: "873101" }),
      store,
      user: { id: USER_ID, name: "Ana", email: "ana@example.com" },
      subscriptions: [{ provider: "mercadopago", status: "active" }],
      planType: "quarterly_starter",
      pixMethodCode: "pix_from_account",
      vindiSubscriptionsEnabled: true,
      now,
    });

    assert.equal(result.reused, false);
    assert.equal(result.link.pixCopyPasteCode, EMV);
    assert.equal(result.link.amount, 80100);
    assert.equal(
      calls.some((call) => call.path === "/v1/subscriptions"),
      false,
    );
    const bill = calls.find((call) => call.path === "/v1/bills")?.body as {
      metadata: { purpose: string; plan_type: string };
    };
    assert.equal(bill.metadata.purpose, "subscription");
    assert.equal(bill.metadata.plan_type, "quarterly_starter");
  });

  it("reuses a pending link of the same user, plan, and amount without creating a bill", async () => {
    const { client, calls } = recordingClient(() => {
      throw new Error("Vindi must not be called");
    });
    const store = memoryPixStore([
      {
        id: "link-keep",
        userId: USER_ID,
        planType: "quarterly_starter",
        amount: 80100,
        currency: "brl",
        emvPayload: EMV,
        vindiBillId: "1601",
        vindiChargeId: "99",
        status: "pending",
        source: "backoffice",
        expiresAt: new Date("2026-08-20T15:00:00.000Z"),
        createdAt: now,
      },
    ]);

    const result = await createOrReuseBackofficeVindiPix({
      client,
      customers: memoryCustomers({ [USER_ID]: "873101" }),
      store,
      user: { id: USER_ID, name: "Ana", email: "ana@example.com" },
      subscriptions: [],
      planType: "quarterly_starter",
      pixMethodCode: "pix_from_account",
      vindiSubscriptionsEnabled: true,
      now,
    });

    assert.equal(result.reused, true);
    assert.equal(result.link.id, "link-keep");
    assert.equal(result.link.pixCopyPasteCode, EMV);
    assert.equal(calls.length, 0);
  });

  it("supersedes a stale pending bill before issuing a new plan/amount", async () => {
    const { client, calls } = recordingClient(defaultVindiHandler);
    const store = memoryPixStore([
      {
        id: "stale",
        userId: USER_ID,
        planType: "monthly_pro",
        amount: 49700,
        currency: "brl",
        emvPayload: EMV,
        vindiBillId: "1599",
        vindiChargeId: "88",
        status: "pending",
        source: "backoffice",
        expiresAt: new Date("2026-08-20T15:00:00.000Z"),
        createdAt: now,
      },
    ]);

    const result = await createOrReuseBackofficeVindiPix({
      client,
      customers: memoryCustomers({ [USER_ID]: "873101" }),
      store,
      user: { id: USER_ID, name: "Ana", email: "ana@example.com" },
      subscriptions: [],
      planType: "quarterly_starter",
      pixMethodCode: "pix_from_account",
      vindiSubscriptionsEnabled: true,
      now,
    });

    assert.equal(result.reused, false);
    assert.equal(store.links[0]?.status, "superseded");
    assert.equal(
      calls.some((call) => call.method === "DELETE" && call.path === "/v1/bills/1599"),
      true,
    );
  });

  it("blocks a live Stripe subscription and a disabled flag without calling Vindi", async () => {
    const { client } = recordingClient(() => {
      throw new Error("Vindi must not be called");
    });
    const store = memoryPixStore();
    const base = {
      client,
      customers: memoryCustomers(),
      store,
      user: { id: USER_ID, name: "Ana", email: "ana@example.com" },
      planType: "quarterly_starter" as const,
      pixMethodCode: "pix_from_account",
      now,
    };

    await assert.rejects(
      () =>
        createOrReuseBackofficeVindiPix({
          ...base,
          subscriptions: [{ provider: null, status: "active" }],
          vindiSubscriptionsEnabled: true,
        }),
      BackofficePixStripeBlockError,
    );
    await assert.rejects(
      () =>
        createOrReuseBackofficeVindiPix({
          ...base,
          subscriptions: [],
          vindiSubscriptionsEnabled: false,
        }),
      /As cobranças Vindi de assinatura estão desligadas/,
    );
  });
});

describe("markVindiPaidOutOfBand", () => {
  it("cancels the open bill, extends access, and writes its own audit action", async () => {
    const { client, calls } = recordingClient(defaultVindiHandler);
    const audits: Array<Record<string, string | null>> = [];
    const store: VindiPaidOutOfBandStore & {
      expiration: Date | null;
      subscriptionStatus: string;
      linkStatus: string;
    } = {
      expiration: new Date("2026-08-10T12:00:00.000Z"),
      subscriptionStatus: "past_due",
      linkStatus: "pending",
      async getSnapshot() {
        return {
          userId: USER_ID,
          expirationDate: store.expiration,
          planType: "monthly_pro" as const,
          subscriptionId: "sub-1",
          subscriptionStatus: store.subscriptionStatus,
          openLinks: [
            {
              id: "link-1",
              vindiBillId: "1601",
              planType: "quarterly_starter" as const,
              status: store.linkStatus,
            },
          ],
          failedPaymentBillId: "1600",
        };
      },
      async setExpiration(_userId, date) {
        store.expiration = date;
      },
      async markLinksCanceled(ids) {
        if (ids.includes("link-1")) store.linkStatus = "canceled";
      },
      async writeAudit(entry) {
        audits.push(entry);
      },
    };

    const result = await markVindiPaidOutOfBand({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      now: new Date("2026-08-17T12:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.newExpiration.toISOString(), "2026-11-17T12:00:00.000Z");
    assert.equal(store.expiration?.toISOString(), "2026-11-17T12:00:00.000Z");
    assert.equal(store.linkStatus, "canceled");
    assert.deepEqual(
      calls
        .filter((call) => call.method === "DELETE")
        .map((call) => call.path)
        .sort(),
      ["/v1/bills/1600", "/v1/bills/1601"],
    );
    assert.equal(audits[0]?.action, "mark_vindi_paid_out_of_band");
    assert.equal(audits[0]?.adminEmail, "admin@automatize.com");
  });

  it("treats a missing Vindi bill as already canceled", async () => {
    const { client } = recordingClient((request) => {
      if (request.method === "DELETE") {
        throw new VindiApiError(404, [
          { id: "not_found", message: "Bill not found" },
        ]);
      }
      throw new Error(`unexpected ${request.method} ${request.path}`);
    });
    const store: VindiPaidOutOfBandStore = {
      async getSnapshot() {
        return {
          userId: USER_ID,
          expirationDate: null,
          planType: "monthly_pro",
          subscriptionId: "sub-1",
          subscriptionStatus: "past_due",
          openLinks: [],
          failedPaymentBillId: "1600",
        };
      },
      async setExpiration() {},
      async markLinksCanceled() {},
      async writeAudit() {},
    };

    const result = await markVindiPaidOutOfBand({
      client,
      store,
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      now,
    });
    assert.equal(result.ok, true);
  });

  it("refuses when there is no open Vindi bill", async () => {
    const { client } = recordingClient(() => {
      throw new Error("Vindi must not be called");
    });
    const result = await markVindiPaidOutOfBand({
      client,
      store: {
        async getSnapshot() {
          return {
            userId: USER_ID,
            expirationDate: null,
            planType: "monthly_pro",
            subscriptionId: "sub-1",
            subscriptionStatus: "active",
            openLinks: [],
            failedPaymentBillId: null,
          };
        },
        async setExpiration() {},
        async markLinksCanceled() {},
        async writeAudit() {},
      },
      userId: USER_ID,
      adminEmail: "admin@automatize.com",
      now,
    });
    assert.deepEqual(result, { ok: false, error: "no_open_bill" });
  });
});

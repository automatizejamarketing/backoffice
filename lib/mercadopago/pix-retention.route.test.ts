import assert from "node:assert/strict";
import test from "node:test";
import * as bunTest from "bun:test";
import { BackofficePixRetentionConflictError } from "./pix-retention-contract";

const mock = (bunTest as any).mock;

class RouteDb {
  select() {
    const query: any = {
      from: () => query,
      where: () => query,
      limit: () => query,
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve([{ id: "user-1", email: "customer@example.com", name: "Customer" }]).then(resolve, reject),
    };
    return query;
  }
}

const routeDb = new RouteDb();
let serviceMode: "conflict" | "success" = "conflict";

mock.module("next/cache", () => ({ revalidatePath: () => undefined }));
mock.module("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));
mock.module("drizzle-orm", () => ({ eq: () => ({}) }));
mock.module("@/lib/auth/rbac", () => ({
  requireBackofficePermissionResponse: async () => ({
    ok: true,
    actor: { email: "admin@example.com" },
  }),
}));
mock.module("@/lib/db", () => ({ db: routeDb }));
mock.module("@/lib/db/schema", () => ({
  PLAN_TYPE_VALUES: ["monthly_starter"],
  user: { id: "user-id" },
}));
mock.module("@/lib/mercadopago/pix-errors", () => ({
  formatMercadoPagoPixError: (message: string) => message,
}));
mock.module("@/lib/mercadopago/pix", () => ({
  BackofficePixRetentionConflictError,
  backofficePixRetentionConflictResponse: (error: InstanceType<typeof BackofficePixRetentionConflictError>) => ({
    status: 409,
    body: { error: error.message, code: error.code, details: error.details },
  }),
  createOrReuseBackofficePixLink: async () => {
    if (serviceMode === "conflict") {
      throw new BackofficePixRetentionConflictError(
        "retention_reconciliation_required",
        "Provider status is uncertain",
        { providerPaymentId: "mp-1" },
      );
    }
    return {
      id: "link-1",
      planType: "monthly_starter",
      amount: 90000,
      originalAmountCentavos: 120000,
      discountPercent: 25,
      discountAmountCentavos: 30000,
      finalAmountCentavos: 90000,
      retentionBenefitId: "benefit-1",
      currency: "brl",
      preferenceId: "link-1",
      initPoint: "pix-code",
      pixCopyPasteCode: "pix-code",
      mercadopagoPaymentId: "mp-1",
      status: "pending",
      source: "backoffice",
      adminEmail: "admin@example.com",
      expiresAt: new Date("2026-09-27T00:00:00Z"),
      createdAt: new Date("2026-09-20T00:00:00Z"),
      reused: false,
    };
  },
  sendBackofficePixLinkEmail: async () => undefined,
  serializeBackofficePixLink: (link: any) => ({
    id: link.id,
    planType: link.planType,
    amount: link.amount,
    originalAmount: link.originalAmountCentavos,
    discountPercent: link.discountPercent,
    discountAmount: link.discountAmountCentavos,
    finalAmount: link.finalAmountCentavos,
    retentionBenefitId: link.retentionBenefitId,
    currency: link.currency,
    preferenceId: link.preferenceId,
    initPoint: link.initPoint,
    pixCopyPasteCode: link.pixCopyPasteCode,
    mercadopagoPaymentId: link.mercadopagoPaymentId,
    status: link.status,
    source: link.source,
    adminEmail: link.adminEmail,
    expiresAt: link.expiresAt.toISOString(),
    createdAt: link.createdAt.toISOString(),
  }),
}));

const { POST } = await import("../../app/api/users/[id]/mercadopago-pix/route");

function request() {
  return new Request("http://localhost/api/users/user-1/mercadopago-pix", {
    method: "POST",
    body: JSON.stringify({ planType: "monthly_starter", sendEmail: false }),
    headers: { "content-type": "application/json" },
  });
}

test("route handler returns typed HTTP 409 for reconciliation conflicts", async () => {
  serviceMode = "conflict";
  const response = await POST(request(), { params: Promise.resolve({ id: "user-1" }) });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Provider status is uncertain",
    code: "retention_reconciliation_required",
    details: { providerPaymentId: "mp-1" },
  });
});

test("route handler returns the true discounted amount and snapshots", async () => {
  serviceMode = "success";
  const response = await POST(request(), { params: Promise.resolve({ id: "user-1" }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.link.amount, 90000);
  assert.equal(body.link.originalAmount, 120000);
  assert.equal(body.link.discountAmount, 30000);
  assert.equal(body.link.finalAmount, 90000);
  assert.equal(body.link.retentionBenefitId, "benefit-1");
  assert.equal(body.reused, false);
});

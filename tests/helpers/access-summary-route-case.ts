import assert from "node:assert/strict";
import * as bunTest from "bun:test";

const { mock } = bunTest as unknown as {
  mock: { module(specifier: string, factory: () => unknown): void };
};

// Runs in its own process: `mock.module` is global and would leak into the
// rest of the suite.
process.env.POSTGRES_URL = "postgres://test:test@127.0.0.1:1/test";

const assignedUserId = "00000000-0000-4000-8000-000000000201";
const otherUserId = "00000000-0000-4000-8000-000000000202";
const missingUserId = "00000000-0000-4000-8000-000000000203";

const guardCalls: Array<[string, string]> = [];
const loaderCalls: string[] = [];

mock.module("@/lib/auth/rbac", () => ({
  requireMarketingUserAccessResponse: async (userId: string, permission: string) => {
    guardCalls.push([userId, permission]);
    if (userId === otherUserId) {
      return {
        ok: false,
        response: Response.json({ error: "Forbidden" }, { status: 403 }),
      };
    }
    return {
      ok: true,
      actor: { id: "consultant", email: "c@example.test", role: "marketing_consultant" },
    };
  },
}));

const summary = {
  access: { tone: "success", label: "Ativo até 30/09/2026", hint: "em 21 dias" },
  billing: {
    title: "Stripe/cartão · Starter Mensal",
    badge: { tone: "success", label: "Ativa", hint: "próxima cobrança 30/09/2026" },
  },
  notice: null,
};

mock.module("@/lib/db/access-summary-queries", () => ({
  getUserAccessSummary: async (userId: string) => {
    loaderCalls.push(userId);
    return userId === missingUserId ? null : summary;
  },
}));

const { GET } = await import("../../app/api/users/[id]/access-summary/route");

function call(userId: string) {
  return GET(new Request(`http://localhost/api/users/${userId}/access-summary`), {
    params: Promise.resolve({ id: userId }),
  });
}

// Consultant outside their portfolio: refused before any billing read.
const denied = await call(otherUserId);
assert.equal(denied.status, 403);
assert.deepEqual(loaderCalls, [], "billing must not load for a client outside the consultant's access");

// The same guard as the marketing page: marketing:read on this client.
const ok = await call(assignedUserId);
assert.equal(ok.status, 200);
assert.deepEqual(await ok.json(), summary);
assert.deepEqual(guardCalls.at(-1), [assignedUserId, "marketing:read"]);

const missing = await call(missingUserId);
assert.equal(missing.status, 404);

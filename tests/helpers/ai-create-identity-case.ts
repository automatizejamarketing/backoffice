import assert from "node:assert/strict";
// @ts-expect-error Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { user, subscription } from "../../lib/db/schema";

process.env.POSTGRES_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.REDIS_URL = "";
process.env.BYPASS_STRIPE = "false";
const customerId = "customer-identity-fixture";
const dialect = new PgDialect();
let subscriptionStatus = "active";
mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        assert.ok(table === user || table === subscription);
        const query = {
          where: (predicate: SQL) => {
            assert.ok(dialect.sqlToQuery(predicate).params.includes(customerId), "Policy must read the authorized customer rather than the operator");
            return query;
          },
          orderBy: () => query,
          limit: async () => table === user
            ? [{ expirationDate: new Date("2099-01-01T00:00:00Z") }]
            : [{ status: subscriptionStatus }],
        };
        return query;
      },
    }),
  },
}));
mock.module("@/lib/meta-business/ai-campaign-auth", () => ({
  authorizeAiCampaignWrite: async () => ({ ok: true, accountId: "111", userId: customerId, actor: { id: "operator-identity-fixture" }, accessToken: "test-token", connection: { tokenKind: "bisu", bisuAppScopedId: "bisu-app-scoped" } }),
  isTokenInvalidError: () => false,
  tokenInvalidJson: () => new Response(null, { status: 401 }),
}));
mock.module("@/lib/db/admin-queries", () => ({ getPrimaryCompanyForUser: async () => ({ niche: "food_service" }) }));
mock.module("@/lib/meta-business/insights", () => ({ fetchAccountContext: async () => ({ currency: "BRL", timezoneName: "America/Sao_Paulo", minDailyBudgetCents: 100 }) }));
let receivedContext: { tokenKind?: string; bisuAppScopedId?: string | null } | undefined;
let receivedPeriod: { startTime: string; endTime: string } | undefined;
mock.module("@/lib/meta-business/marketing/ai-creation", () => ({
  MoldNotFoundError: class extends Error {},
  createPlannedCampaign: async (ctx: { tokenKind?: string; bisuAppScopedId?: string | null }, _mold: unknown, answers: { period: { startTime: string; endTime: string } }) => {
    receivedContext = ctx;
    receivedPeriod = answers.period;
    return { ok: true, campaignId: "campaign", adSetIds: [], adIds: [] };
  },
}));
globalThis.fetch = (() => { throw new Error("Unexpected network request"); }) as typeof fetch;
const { POST } = await import("../../app/api/meta-marketing/[accountId]/campaigns/ai/create/route");
for (const scenario of [
  { status: "active", end: "2027-01-31T18:35:00.000Z" },
  { status: "trialing", end: "2027-01-08T18:35:00.000Z" },
  { status: "trialing", end: "2027-01-13T18:35:00.000Z", explicit: true },
]) {
  subscriptionStatus = scenario.status;
  const response = await POST(new Request(`http://localhost/api/meta-marketing/111/campaigns/ai/create?userId=${customerId}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mold: { adSetId: "mold" }, answers: { dailyBudget: 50, medias: [{ kind: "image", imageUrl: "https://example.test/image.jpg" }], period: { startTime: "2027-01-01T18:35:00Z", ...(scenario.explicit ? { endTime: scenario.end } : {}) } } }),
  }) as never, { params: Promise.resolve({ accountId: "111" }) });
  assert.equal(response.status, 200);
  assert.equal(receivedContext?.tokenKind, "bisu", "The shared identity resolver must use the customer's token kind");
  assert.equal(receivedContext?.bisuAppScopedId, "bisu-app-scoped", "BISU advertising grants must use the same scoped actor as account authorization");
  assert.deepEqual(receivedPeriod, { startTime: "2027-01-01T18:35:00.000Z", endTime: scenario.end });
}

import assert from "node:assert/strict";

const { mock } = require("bun:test") as { mock: { module(specifier: string, factory: () => unknown): void } };
process.env.POSTGRES_URL = "postgres://test:test@127.0.0.1:1/test";
process.env.REDIS_URL = "";
mock.module("@/lib/meta-business/ai-campaign-auth", () => ({
  authorizeAiCampaignWrite: async () => ({ ok: true, accountId: "111", userId: "user", accessToken: "test-token", connection: { tokenKind: "bisu", bisuAppScopedId: "bisu-app-scoped" } }),
  isTokenInvalidError: () => false,
  tokenInvalidJson: () => new Response(null, { status: 401 }),
}));
mock.module("@/lib/db/admin-queries", () => ({ getPrimaryCompanyForUser: async () => ({ niche: "food_service" }) }));
mock.module("@/lib/meta-business/insights", () => ({ fetchAccountContext: async () => ({ currency: "BRL", timezoneName: "America/Sao_Paulo", minDailyBudgetCents: 100 }) }));
let receivedContext: { tokenKind?: string; bisuAppScopedId?: string | null } | undefined;
mock.module("@/lib/meta-business/marketing/ai-creation", () => ({
  MoldNotFoundError: class extends Error {},
  createPlannedCampaign: async (ctx: { tokenKind?: string; bisuAppScopedId?: string | null }) => {
    receivedContext = ctx;
    return { ok: true, campaignId: "campaign", adSetIds: [], adIds: [] };
  },
}));
globalThis.fetch = (() => { throw new Error("Unexpected network request"); }) as typeof fetch;
const { POST } = await import("../../app/api/meta-marketing/[accountId]/campaigns/ai/create/route");
const response = await POST(new Request("http://localhost/api/meta-marketing/111/campaigns/ai/create?userId=user", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ mold: { adSetId: "mold" }, answers: { dailyBudget: 50, medias: [{ kind: "image", imageUrl: "https://example.test/image.jpg" }] } }),
}) as never, { params: Promise.resolve({ accountId: "111" }) });
assert.equal(response.status, 200);
assert.equal(receivedContext?.tokenKind, "bisu", "The shared identity resolver must use the customer's token kind");
assert.equal(receivedContext?.bisuAppScopedId, "bisu-app-scoped", "BISU advertising grants must use the same scoped actor as account authorization");

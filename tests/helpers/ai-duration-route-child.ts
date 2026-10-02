// Shared-module doubles run only in this child process, never in Bun's suite registry.
import assert from "node:assert/strict";
// @ts-ignore Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import { resolveAiCampaignPeriod } from "../../lib/meta-business/ai-campaign-duration";

const backoffice = process.argv[2] === "backoffice";
const root = backoffice ? process.env.BACKOFFICE_ROOT! : process.env.FRONTEND_ROOT!;
const stub = (name: string, factory: () => any) => mock.module(name, factory);
const customerId = "customer-qa";
const loaded: string[] = [];
let days: 7 | 30 = 7;
let fail = false;
let scans = 0;
let captured: any;
let writes = 0;
stub("server-only", () => ({}));
stub("@/lib/meta-business/marketing/ai-creation/duration-loader", () => ({
  loadAiCampaignDuration: async (id: string) => {
    loaded.push(id);
    if (fail) throw new Error("Policy lookup failed");
    return { accountState: days === 7 ? "trial" : "active", defaultDurationDays: days };
  },
}));
stub(backoffice ? "@/lib/db" : "@/lib/db/queries", () => ({ db: {}, getPrimaryCompanyForUser: async () => null }));
if (backoffice) {
  stub("@/lib/db/admin-queries", () => ({ getPrimaryCompanyForUser: async () => null }));
  stub("@/lib/meta-business/ai-campaign-auth", () => ({
    authorizeAiCampaignWrite: async () => ({ ok: true, userId: customerId, actor: { id: "operator-qa" }, accessToken: "test", accountId: "123" }),
    isTokenInvalidError: () => false, tokenInvalidJson: () => null,
  }));
} else {
  stub("@/lib/meta-business/marketing/authorized-access", () => ({
    requireAuthorizedMarketingAccess: async () => ({ userId: customerId, accessToken: "test" }),
    isAuthorizedMarketingAccess: () => true,
  }));
  stub("@/lib/security/expensive-route", () => ({ guardPaidUpstreamForUser: async () => null }));
}
stub("@/lib/meta-business/insights", () => ({ fetchAccountContext: async () => ({ currency: "BRL", timezoneName: "America/Sao_Paulo" }), callMeta: async () => ({}), minorToMajor: () => null }));
let cached: unknown;
stub("@/lib/meta-business/read-cache", () => ({ tokenCacheId: () => "test", cachedMetaRead: async ({ fetcher }: any) => cached ??= await fetcher() }));
stub("@/lib/meta-business/marketing/ai-creation", () => ({
  MoldNotFoundError: class extends Error {}, isDemographicLimits: () => true,
  scanAccountForMold: async () => { scans++; return { mold: null, truncated: false, currency: "BRL" }; },
  listProvenAdsInCampaign: async () => [], SALES_CAMPAIGN_OBJECTIVES: ["OUTCOME_SALES"],
  planDuplicatedCampaign: async (_: any, __: any, answers: any) => { captured = answers; return { review: { budget: { startTime: answers.period?.startTime, stopTime: answers.period?.endTime } }, issues: [] }; },
  createPlannedCampaign: async (_: any, __: any, answers: any) => { writes++; captured = answers; return { ok: true }; },
}));
stub("@/lib/meta-business/marketing/ai-creation/fallback-publish", () => ({ publishFallbackCampaign: async ({ input }: any) => { writes++; captured = input; return { ok: true }; } }));

const routePath = (name: string) => `${root}/app/api/${backoffice ? "meta-marketing/[accountId]/campaigns" : "meta-business/marketing/campaign"}/ai/${name}/route.ts`;
const call = async (name: string, body: unknown) => {
  const { POST } = await import(routePath(name));
  return POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ accountId: "123", ...body as any }) }), { params: Promise.resolve({ accountId: "123" }) });
};
for (days of [7, 30] as const) {
  assert.equal((await (await call("scan", {})).json()).durationPolicy.defaultDurationDays, days);
}
assert.equal(scans, 1, "Meta scan remains cached while policy changes");
assert.equal((await (await call("scan", { objective: "followers" })).json()).durationPolicy.defaultDurationDays, 30);
assert.deepEqual(loaded, [customerId, customerId, customerId]);
const startTime = "2027-01-01T18:00:00Z";
const body = { mold: { adSetId: "mold" }, answers: { dailyBudget: 30, period: { startTime } } };
const plan = await (await call("plan", body)).json();
assert.deepEqual(captured.period, resolveAiCampaignPeriod({ period: { startTime }, defaultDurationDays: 30, defaultStartTime: startTime }));
if (backoffice) {
  const reviewed = { startTime: plan.review.budget.startTime, endTime: plan.review.budget.stopTime };
  await call("create", { ...body, answers: { ...body.answers, period: reviewed } });
  assert.deepEqual(captured.period, reviewed);
  await call("fallback", { niche: "outros", objective: "followers", dailyBudget: 30, pageId: "page", defaultDurationDays: 7, period: { startTime } });
  assert.equal(captured.defaultDurationDays, 30, "browser cannot dictate policy");
  assert.deepEqual(captured.period, resolveAiCampaignPeriod({ period: { startTime }, defaultDurationDays: 30, defaultStartTime: startTime }));
  fail = true;
  const priorWrites = writes;
  assert.equal((await call("create", body)).status, 500);
  assert.equal(writes, priorWrites);
} else {
  stub("@/lib/meta-business/marketing/require-account-access", () => ({ requireBusinessAdAccountAccess: async () => ({ ok: true }), requireEnabledMarketingIdentity: async () => ({ ok: true }), accountAccessDenialBody: () => ({}) }));
  stub("@/lib/meta-business/marketing/pixel-check/apply-mold-pixel-override", () => ({ applyMoldPixelOverride: async () => ({ ok: true }) }));
  const { createAiCampaign } = await import(`${root}/lib/meta-business/marketing/create-ai-campaign.ts`);
  const reviewed = { startTime: plan.review.budget.startTime, endTime: plan.review.budget.stopTime };
  const args: any = { userId: customerId, connection: { accessToken: "test" }, body: { accountId: "123", ...body, answers: { ...body.answers, period: reviewed } } };
  await createAiCampaign(args);
  assert.deepEqual(captured.period, reviewed);
  fail = true;
  const priorWrites = writes;
  await assert.rejects(createAiCampaign(args), /Policy lookup failed/);
  assert.equal(writes, priorWrites);
}
console.log("route duration behavior PASS");

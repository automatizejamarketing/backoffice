// Only auth and database IO are doubled, inside a dedicated process. The route,
// customer duration loader, publisher and Meta payload builders all remain real.
import assert from "node:assert/strict";
// @ts-expect-error Bun's runtime mock API is absent from this repository's test declarations.
import { mock } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { user, subscription } from "../../lib/db/schema";
import { NextRequest } from "next/server";
import { installMetaFetchStub, type MetaRequest } from "./meta-fetch-stub";

const niche = process.argv[2];
assert.ok(["retail", "real_estate_broker", "service", "insurance_broker", "outros"].includes(niche));
const customerId = "customer-whatsapp-fixture";
let subscriptionStatus = "active";
let policyFailure = false;
const dialect = new PgDialect();

mock.module("server-only", () => ({}));
mock.module("@/lib/meta-business/ai-campaign-auth", () => ({
  authorizeAiCampaignWrite: async () => ({
    ok: true, userId: customerId, actor: { id: "operator-whatsapp-fixture" },
    accessToken: "test-token", accountId: "123",
  }),
  isTokenInvalidError: () => false,
  tokenInvalidJson: () => null,
}));
mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        assert.ok(table === user || table === subscription, "Only customer policy reads are permitted");
        const query = {
          where: (predicate: SQL) => {
            assert.ok(dialect.sqlToQuery(predicate).params.includes(customerId), "Policy must read the authorized customer, not the operator");
            return query;
          },
          orderBy: () => query,
          limit: async () => {
            if (policyFailure) throw new Error("Policy lookup failed");
            return table === user
              ? [{ expirationDate: new Date("2099-01-01T00:00:00Z") }]
              : [{ status: subscriptionStatus }];
          },
        };
        return query;
      },
    }),
  },
}));

// The shared Graph stub falls through for other URLs; its fallback is a throw
// guard here, so no request can reach a real network even on unexpected paths.
globalThis.fetch = (() => { throw new Error("No real network is permitted"); }) as typeof fetch;
delete process.env.META_CBO_DAYPARTING_ACCOUNT_IDS;
const unexpectedRequests: string[] = [];
const stub = installMetaFetchStub((request) => {
  const { method, path } = request;
  if (method === "GET" && path === "me/accounts") return { body: { data: [] } };
  if (method === "GET" && path === "page-fixture") return { body: { id: path, has_whatsapp_number: true } };
  if (method === "GET" && path === "video-fixture") return { body: { picture: "https://example.com/thumbnail.jpg" } };
  if (method === "GET" && path === "adset-fixture/ads") return { body: { data: [] } };
  if (method === "POST") {
    const ids: Record<string, string> = {
      "act_123/campaigns": "campaign-fixture",
      "act_123/adsets": "adset-fixture",
      "act_123/adcreatives": "creative-fixture",
      "act_123/ads": "ad-fixture",
    };
    if (ids[path]) return { body: { id: ids[path] } };
    if (["campaign-fixture", "adset-fixture", "ad-fixture"].includes(path) && request.params.get("status") === "ACTIVE") {
      return { body: { success: true } };
    }
  }
  unexpectedRequests.push(`${method} ${path}`);
  throw new Error(`Unexpected fixture request: ${method} ${path}`);
});

const { POST } = await import("../../app/api/meta-marketing/[accountId]/campaigns/ai/fallback/route");
const startTime = "2027-01-01T18:35:00Z";
const call = (period?: { startTime: string; endTime?: string }) => POST(new NextRequest(
  "http://localhost/api?userId=customer-whatsapp-fixture", {
    method: "POST",
    body: JSON.stringify({
      niche, objective: "whatsapp", dailyBudget: 30, pageId: "page-fixture",
      media: [{ kind: "video", videoId: "video-fixture" }],
      texts: { headline: "Fixture", message: "Fixture" },
      locations: [{ key: "BR", name: "Brasil", type: "country" }],
      whatsappWelcome: { autofillMessage: "Quero saber mais" }, deliveryMode: "all_day",
      // Caller-supplied defaults must not replace the authorized customer's policy.
      defaultDurationDays: subscriptionStatus === "trialing" ? 30 : 7,
      ...(period ? { period } : {}),
    }),
  },
), { params: Promise.resolve({ accountId: "123" }) });
const created = (calls: MetaRequest[], path: string) => {
  const request = calls.find((c) => c.method === "POST" && c.path === path && !c.isValidateOnly);
  assert.ok(request, `Expected real create payload for ${path}`);
  return request.params;
};

try {
  for (const scenario of [
    { status: "active", days: 30, cents: "90000", end: "2027-01-31T18:35:00.000Z" },
    { status: "trialing", days: 7, cents: "21000", end: "2027-01-08T18:35:00.000Z" },
    { status: "trialing", days: 12, cents: "36000", end: "2027-01-13T18:35:00.000Z", explicit: true },
  ]) {
    subscriptionStatus = scenario.status;
    stub.calls.length = 0;
    const response = await call({ startTime, ...(scenario.explicit ? { endTime: scenario.end } : {}) });
    const body = await response.json();
    console.log(JSON.stringify({ niche, account: scenario.status, days: scenario.days, status: response.status, result: body }));
    assert.equal(response.status, 200);
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.campaignId, "campaign-fixture");
    assert.deepEqual(body.adSetIds, ["adset-fixture"]);
    assert.deepEqual(body.adIds, ["ad-fixture"]);
    const campaign = created(stub.calls, "act_123/campaigns");
    assert.equal(campaign.get("objective"), "OUTCOME_ENGAGEMENT");
    assert.equal(campaign.get("start_time"), "2027-01-01T18:35:00.000Z");
    assert.equal(campaign.get("stop_time"), scenario.end);
    assert.equal(campaign.get("lifetime_budget"), scenario.cents);
    assert.equal(campaign.has("daily_budget"), false);
    const adset = created(stub.calls, "act_123/adsets");
    assert.equal(adset.get("start_time"), "2027-01-01T18:35:00.000Z");
    assert.equal(adset.get("end_time"), scenario.end);
    assert.equal(adset.get("destination_type"), "WHATSAPP");
    assert.equal(adset.get("optimization_goal"), "CONVERSATIONS");
    assert.deepEqual(JSON.parse(adset.get("promoted_object")!), { page_id: "page-fixture" });
    const creative = created(stub.calls, "act_123/adcreatives");
    const story = JSON.parse(creative.get("object_story_spec")!);
    assert.equal(story.page_id, "page-fixture");
    assert.equal(story.video_data.video_id, "video-fixture");
    assert.equal(story.video_data.call_to_action.type, "WHATSAPP_MESSAGE");
    assert.equal(story.video_data.call_to_action.value.app_destination, "WHATSAPP");
    assert.equal(story.video_data.call_to_action.value.link, "https://api.whatsapp.com/send");
    assert.ok(stub.calls.some((c) => c.path === "campaign-fixture" && c.params.get("status") === "ACTIVE"));
    assert.deepEqual(unexpectedRequests, []);
  }
  // Database failure must still stop publication before the real helper fetches.
  policyFailure = true;
  stub.calls.length = 0;
  const failure = await call({ startTime });
  assert.equal(failure.status, 500);
  assert.equal((await failure.json()).message, "Policy lookup failed");
  assert.equal(stub.calls.length, 0);
  console.log(`${niche}: active30, trial7, explicit12 and policy failure PASS; real network calls=0`);
} finally {
  stub.restore();
}

import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "bun:test";

import { ensureMetaTestEnv, installMetaFetchStub, type MetaRequest } from "./helpers/meta-fetch-stub";

mock.module("server-only", () => ({}));
ensureMetaTestEnv();

const DAY = 86_400;

function rule(source: { id: string; type: "pixel" | "ig_business" }, event: string, retentionDays: number) {
  return { inclusions: { operator: "or", rules: [{ event_sources: [source], retention_seconds: retentionDays * DAY, filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: event }] } }] } };
}

function graph(existing?: { id: string; rule: unknown }) {
  return (request: MetaRequest) => {
    if (request.path.endsWith("/customaudiences")) return { body: { data: [] } };
    if (request.path.endsWith("/adsets")) return { body: { data: [] } };
    if (existing && request.path === existing.id) {
      return { body: { id: existing.id, account_id: "act_9303", name: "Público antigo", rule: existing.rule, permission_for_actions: { can_edit: true } } };
    }
    throw new Error(`Unexpected Graph request: ${request.method} ${request.path}`);
  };
}

async function reviewWebsite(retentionDays: number, audienceId?: string) {
  const { reviewWebsiteAudience } = await import("../lib/meta-business/marketing/audiences/website-operation");
  return reviewWebsiteAudience({ adAccountId: "9303", accessToken: "token", name: "Visitantes do site", selection: { pixelId: "pixel-1", criterion: "visitors", retentionDays }, sources: [{ id: "pixel-1", name: "Pixel", lastFiredTime: "2026-09-29T12:00:00Z" }], ...(audienceId ? { audienceId } : {}) });
}

async function reviewInstagram(retentionDays: number, audienceId?: string) {
  const { reviewInstagramAudience } = await import("../lib/meta-business/marketing/audiences/instagram-operation");
  return reviewInstagramAudience({ adAccountId: "9303", accessToken: "token", name: "Engajou no perfil", selection: { profileId: "ig-1", criterion: "all", retentionDays }, profiles: [{ id: "ig-1" }], ...(audienceId ? { audienceId } : {}) });
}

test("backoffice website review accepts 30 days and rejects 181 days before any write", async () => {
  const stub = installMetaFetchStub(graph());
  try {
    const accepted = await reviewWebsite(30);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const rejected = await reviewWebsite(181);
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.issues[0]?.code, "WEBSITE_PERIOD_OUT_OF_RANGE");
    assert.equal(rejected.issues[0]?.reason, "O período do público do site deve ficar entre 1 e 180 dias.");
    assert.equal(stub.calls.filter((call) => call.method !== "GET").length, 0);
  } finally {
    stub.restore();
  }
});

test("backoffice website review preserves an unchanged 400-day period and rejects a change to 200", async () => {
  const unchanged = installMetaFetchStub(graph({ id: "CA9303", rule: rule({ id: "pixel-1", type: "pixel" }, "PageView", 400) }));
  try {
    const result = await reviewWebsite(400, "CA9303");
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    unchanged.restore();
  }
  const changed = installMetaFetchStub(graph({ id: "CA9303", rule: rule({ id: "pixel-1", type: "pixel" }, "PageView", 30) }));
  try {
    const result = await reviewWebsite(200, "CA9303");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.issues[0]?.code, "WEBSITE_PERIOD_OUT_OF_RANGE");
  } finally {
    changed.restore();
  }
});

test("backoffice instagram review accepts 365 days, rejects 366 and preserves an unchanged 400-day period", async () => {
  const fresh = installMetaFetchStub(graph());
  try {
    const accepted = await reviewInstagram(365);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const rejected = await reviewInstagram(366);
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.issues[0]?.code, "INSTAGRAM_PERIOD_OUT_OF_RANGE");
    assert.equal(rejected.issues[0]?.reason, "O período do público do Instagram deve ficar entre 1 e 365 dias.");
    assert.equal(fresh.calls.filter((call) => call.method !== "GET").length, 0);
  } finally {
    fresh.restore();
  }
  const existing = installMetaFetchStub(graph({ id: "CA9304", rule: rule({ id: "ig-1", type: "ig_business" }, "ig_business_profile_all", 400) }));
  try {
    const result = await reviewInstagram(400, "CA9304");
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    existing.restore();
  }
});

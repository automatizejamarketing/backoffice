import assert from "node:assert/strict";
import test from "node:test";

import { buildWebsiteAudienceRule, parseWebsiteAudienceRule, resolveWebsiteSourceEvidence, WEBSITE_PERIOD_EVIDENCE, websitePeriodEvidenceBySource, websitePeriodEvidenceStatus, websitePeriodSelectionsEqual, websiteSelectionsEqual, extractObservedWebsiteEvents } from "../lib/meta-business/marketing/audiences/website";

test("builds visitor, URL, and event rules with the pixel source", () => {
  assert.equal(buildWebsiteAudienceRule({ pixelId: "pixel-1", criterion: "visitors", retentionDays: 30 }).inclusions.rules[0].event_sources[0].type, "pixel");
  assert.equal(buildWebsiteAudienceRule({ pixelId: "pixel-1", criterion: "url", url: "/precos", retentionDays: 14 }).inclusions.rules[0].filter.filters[0].operator, "i_contains");
  assert.deepEqual(parseWebsiteAudienceRule(buildWebsiteAudienceRule({ pixelId: "pixel-1", criterion: "event", event: "Purchase", retentionDays: 7 })), { pixelId: "pixel-1", criterion: "event", event: "Purchase", retentionDays: 7 });
  assert.equal(buildWebsiteAudienceRule({ pixelId: "pixel-1", criterion: "visitors", retentionDays: 365 }).inclusions.rules[0].retention_seconds, 31_536_000);
});

test("preserves a known period when only a URL or event filter is edited", () => {
  assert.equal(websitePeriodSelectionsEqual({ pixelId: "pixel-1", criterion: "url", url: "/old", retentionDays: 30 }, { pixelId: "pixel-1", criterion: "url", url: "/new", retentionDays: 30 }), true);
  assert.equal(websiteSelectionsEqual({ pixelId: "pixel-1", criterion: "url", url: "/old", retentionDays: 30 }, { pixelId: "pixel-1", criterion: "url", url: "/new", retentionDays: 30 }), false);
});

test("rejects unsupported operators, extra conditions, and exclusions", () => {
  const rule = buildWebsiteAudienceRule({ pixelId: "pixel-1", criterion: "visitors", retentionDays: 7 });
  assert.equal(parseWebsiteAudienceRule({ ...rule, exclusions: { operator: "or", rules: [] } }), null);
  assert.equal(parseWebsiteAudienceRule({ ...rule, inclusions: { ...rule.inclusions, unexpected: true } }), null);
  assert.equal(parseWebsiteAudienceRule({ ...rule, inclusions: { ...rule.inclusions, rules: [{ ...rule.inclusions.rules[0], aggregation: { count: 1 } }] } }), null);
  assert.equal(parseWebsiteAudienceRule({ ...rule, inclusions: { ...rule.inclusions, rules: [{ ...rule.inclusions.rules[0], filter: { operator: "and", filters: [{ field: "url", operator: "i_contains", value: " /x" }] } }] } }), null);
});

test("separates pixel access, activity, observed events, and final availability", () => {
  const source = resolveWebsiteSourceEvidence([{ id: "pixel-1", lastFiredTime: "2026-09-09T00:00:00Z", observedEvents: [] }], "pixel-1");
  assert.deepEqual(source.observedEvents, []);
  assert.equal(source.access, "available");
  assert.equal(source.activity, "available");
  assert.equal(source.availability, "unknown");
});

test("uses only source-scoped observed events and source-scoped period evidence", () => {
  const source = resolveWebsiteSourceEvidence([{ id: "pixel-1", lastFiredTime: "2026-09-09T00:00:00Z", observedEvents: ["Purchase"], observedEventsStatus: "available" }], "pixel-1");
  assert.deepEqual(source.observedEvents, ["Purchase"]);
  assert.equal(source.observedEventsStatus, "available");
  assert.equal(resolveWebsiteSourceEvidence([{ id: "pixel-1", lastFiredTime: "2026-09-09T00:00:00Z", observedEvents: ["Purchase"], observedEventsStatus: "unknown" }], "pixel-1").observedEventsStatus, "unknown");
  assert.deepEqual(extractObservedWebsiteEvents({ data: [{ event: "Purchase", count: 3 }, { event: "ViewContent", count: 0 }] }), ["Purchase"]);
  const evidence = websitePeriodEvidenceBySource(["pixel-1", "pixel-2"]);
  assert.equal(evidence["pixel-1"].visitors.sourceId, "pixel-1");
  assert.equal(evidence["pixel-2"].visitors.sourceId, "pixel-2");
  assert.equal(websiteSelectionsEqual({ pixelId: "pixel-1", criterion: "visitors", retentionDays: 365, url: "/ignored" }, { pixelId: "pixel-1", criterion: "visitors", retentionDays: 365 }), true);
  assert.equal(websiteSelectionsEqual({ pixelId: "pixel-1", criterion: "url", retentionDays: 7, url: "/x" }, { pixelId: "pixel-1", criterion: "url", retentionDays: 7, url: "/y" }), false);
});

test("keeps every website period criterion blocked until its evidence is closed", () => {
  for (const evidence of Object.values(WEBSITE_PERIOD_EVIDENCE)) {
    assert.equal(websitePeriodEvidenceStatus(evidence.criterion), "blocked");
    assert.equal(evidence.initialDays, null);
    assert.equal(evidence.historicalFill, "unknown");
  }
});

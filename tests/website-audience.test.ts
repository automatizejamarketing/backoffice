import assert from "node:assert/strict";
import test from "node:test";

import { buildWebsiteAudienceRule, parseWebsiteAudienceRule, resolveWebsiteSourceEvidence, WEBSITE_PERIOD_EVIDENCE, websitePeriodEvidenceBySource, websitePeriodEvidenceStatus, websitePeriodOutOfRange, websitePeriodSelectionsEqual, websiteSelectionsEqual, extractObservedWebsiteEvents } from "../lib/meta-business/marketing/audiences/website";

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
  const evidence = websitePeriodEvidenceBySource(["pixel-1", "pixel-2"]);
  assert.equal(evidence["pixel-1"].visitors.sourceId, "pixel-1");
  assert.equal(evidence["pixel-2"].visitors.sourceId, "pixel-2");
  assert.equal(websiteSelectionsEqual({ pixelId: "pixel-1", criterion: "visitors", retentionDays: 365, url: "/ignored" }, { pixelId: "pixel-1", criterion: "visitors", retentionDays: 365 }), true);
  assert.equal(websiteSelectionsEqual({ pixelId: "pixel-1", criterion: "url", retentionDays: 7, url: "/x" }, { pixelId: "pixel-1", criterion: "url", retentionDays: 7, url: "/y" }), false);
});

test("reads observed events from the hourly buckets of Meta's pixel stats", () => {
  // Shape of a real GET /{pixel}/stats?aggregation=event (captured 2026-10-06): one bucket per hour, the event name in `value`.
  const response = { data: [
    { start_time: "2026-09-29T20:00:00+0000", aggregation: "event", data: [{ value: "Purchase", count: 1 }] },
    { start_time: "2026-09-29T21:00:00+0000", aggregation: "event", data: [{ value: "PageView", count: 60 }, { value: "Purchase", count: 2 }, { value: "InitiateCheckout", count: 1 }, { value: "AddToCart", count: 1 }] },
    { start_time: "2026-09-29T22:00:00+0000", aggregation: "event", data: [{ value: "PageView", count: 25 }, { value: "Purchase", count: 4 }, { value: "Lead", count: 0 }] },
  ], paging: { cursors: { after: "MTc5MTMxMzIwMAZDZD" } } };
  assert.deepEqual(extractObservedWebsiteEvents(response), ["AddToCart", "InitiateCheckout", "PageView", "Purchase"]);
  assert.deepEqual(extractObservedWebsiteEvents({ data: [] }), []);
  assert.deepEqual(extractObservedWebsiteEvents({ error: { code: 100 } }), []);
});

test("records the documented Meta period contract for every website criterion", () => {
  for (const evidence of Object.values(WEBSITE_PERIOD_EVIDENCE)) {
    assert.equal(websitePeriodEvidenceStatus(evidence.criterion), "ready");
    assert.equal(evidence.initialDays, 30);
    assert.equal(evidence.metaMinimumDays, 1);
    assert.equal(evidence.metaMaximumDays, 180);
    assert.equal(evidence.localValidationMaximumDays, 180);
    assert.equal(evidence.editable, "yes");
    assert.equal(evidence.historicalFill, "available");
    assert.equal(evidence.observedAt, "2026-09-30");
  }
  const visitors = WEBSITE_PERIOD_EVIDENCE.visitors;
  assert.equal(websitePeriodOutOfRange(visitors, 1), false);
  assert.equal(websitePeriodOutOfRange(visitors, 180), false);
  assert.equal(websitePeriodOutOfRange(visitors, 0), true);
  assert.equal(websitePeriodOutOfRange(visitors, 181), true);
  assert.equal(websitePeriodOutOfRange(visitors, 400, true), false);
});

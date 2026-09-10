import assert from "node:assert/strict";
import test from "node:test";

import { buildInstagramAudienceRule, INSTAGRAM_AUDIENCE_CRITERIA, INSTAGRAM_PERIOD_EVIDENCE, instagramAudienceRuleInput, instagramPeriodEvidenceByProfile, instagramPeriodEvidenceFor, instagramPeriodEvidenceStatus, parseInstagramAudienceRule, resolveInstagramSourceEvidence, validateInstagramAudienceSelection } from "../lib/meta-business/marketing/audiences/instagram";

test("builds all five Instagram criteria with an ig_business event source", () => {
  for (const criterion of Object.keys(INSTAGRAM_AUDIENCE_CRITERIA) as Array<keyof typeof INSTAGRAM_AUDIENCE_CRITERIA>) {
    const rule = buildInstagramAudienceRule({ profileId: "ig-1", criterion, retentionDays: 14 });
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "ig_business");
    assert.equal(rule.inclusions.rules[0].filter.filters[0].value, INSTAGRAM_AUDIENCE_CRITERIA[criterion]);
  }
});

test("records unknown period evidence instead of inventing a default", () => {
  for (const evidence of Object.values(INSTAGRAM_PERIOD_EVIDENCE)) {
    assert.equal(instagramPeriodEvidenceStatus(evidence.criterion), "blocked");
    assert.equal(evidence.initialDays, null);
    assert.equal(evidence.metaMaximumDays, null);
    assert.equal(evidence.unit, "days");
    assert.equal(evidence.historicalFill, "unknown");
  }
  assert.throws(() => validateInstagramAudienceSelection({ profileId: "ig-1", criterion: "all", retentionDays: 0 }));
});

test("keys period evidence by the selected Instagram profile and criterion", () => {
  const evidence = instagramPeriodEvidenceFor("ig-1", "saved");
  assert.equal(evidence.profileId, "ig-1");
  assert.equal(evidence.criterion, "saved");
  assert.deepEqual(Object.keys(instagramPeriodEvidenceByProfile(["ig-1", "ig-2"])), ["ig-1", "ig-2"]);
  assert.equal(instagramPeriodEvidenceByProfile(["ig-2"])["ig-2"].messaged.profileId, "ig-2");
});

test("keeps source access separate from activity and audience availability", () => {
  const source = resolveInstagramSourceEvidence([{ id: "ig-1" }], "ig-1");
  assert.equal(source.access, "available");
  assert.equal(source.activity, "unknown");
  assert.equal(source.availability, "unknown");
  assert.equal(resolveInstagramSourceEvidence([], "ig-1").access, "unavailable");
});

test("round-trips the real retention for a simple editable rule", () => {
  const selection = { profileId: "ig-1", criterion: "saved" as const, retentionDays: 63 };
  assert.deepEqual(parseInstagramAudienceRule(buildInstagramAudienceRule(selection)), selection);
  assert.equal(instagramAudienceRuleInput(selection).inclusions[0].eventSources[0].type, "ig_business");
  assert.equal(parseInstagramAudienceRule({ ...buildInstagramAudienceRule(selection), exclusions: { operator: "or", rules: [] } }), null);
  assert.equal(parseInstagramAudienceRule({ ...buildInstagramAudienceRule(selection), inclusions: { ...buildInstagramAudienceRule(selection).inclusions, unexpected: true } }), null);
  assert.equal(parseInstagramAudienceRule({ ...buildInstagramAudienceRule(selection), inclusions: { ...buildInstagramAudienceRule(selection).inclusions, rules: [{ ...buildInstagramAudienceRule(selection).inclusions.rules[0], aggregation: { event: "count" } }] } }), null);
});

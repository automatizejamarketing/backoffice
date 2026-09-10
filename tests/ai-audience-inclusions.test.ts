import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAudienceInclusions,
  summarizeAudienceTargeting,
  validateAppliedAudienceTargeting,
  validateAudienceInclusionIds,
  validateAudienceInclusionsAgainstLibrary,
} from "../lib/meta-business/marketing/ai-creation/audience-inclusions";
import { applyAudienceExclusions } from "../lib/meta-business/marketing/ai-creation/audience-exclusions";
import type { CustomAudienceView } from "../lib/meta-business/marketing/audiences/types";

function audience(id: string, overrides: Partial<CustomAudienceView> = {}): CustomAudienceView {
  return {
    id,
    name: id,
    ruleSummary: "not_loaded",
    capabilities: {
      read: "available",
      include: "unknown",
      exclude: "unknown",
      editMetadata: "unknown",
      share: "unknown",
      editRule: "unknown",
      manageMembers: "unknown",
      delete: "unknown",
      lookalikeSource: "unknown",
    },
    ...overrides,
  };
}

test("inclusions replace only the include field and disable both expansions", () => {
  const base = {
    geo_locations: { countries: ["BR"] },
    custom_audiences: [{ id: "old" }],
    excluded_custom_audiences: [{ id: "buyers" }],
    targeting_automation: { advantage_audience: 1 },
  };
  const result = applyAudienceInclusions(base, ["new-1", "new-2"]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.targeting, {
    ...base,
    custom_audiences: [{ id: "new-1" }, { id: "new-2" }],
    excluded_custom_audiences: [{ id: "buyers" }],
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
  });
  assert.deepEqual(base.custom_audiences, [{ id: "old" }]);
});

test("undefined preserves and [] clears inclusions without clearing exclusions", () => {
  const base = {
    custom_audiences: [{ id: "old" }],
    excluded_custom_audiences: [{ id: "buyers" }],
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
  };

  assert.deepEqual(applyAudienceInclusions(base, undefined).targeting, base);
  assert.deepEqual(applyAudienceInclusions(base, []).targeting, {
    excluded_custom_audiences: [{ id: "buyers" }],
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
  });
  assert.deepEqual(
    applyAudienceInclusions(base, [], { preserveManualAdvantage: true }).targeting,
    {
      excluded_custom_audiences: [{ id: "buyers" }],
      targeting_automation: { advantage_audience: 0 },
      targeting_relaxation_types: { lookalike: 0, custom_audience: 0 },
    },
  );
  const inheritedDemographics = applyAudienceInclusions(
    { ...base, age_min: 25, age_max: 55 },
    [],
  ).targeting!;
  assert.equal(
    (inheritedDemographics.targeting_automation as { advantage_audience?: number })
      .advantage_audience,
    0,
  );
});

test("clearing inclusions preserves the base expansion mode and flags", () => {
  const baseWithExpansion = {
    custom_audiences: [{ id: "old" }],
    targeting_automation: { advantage_audience: 1 },
    targeting_relaxation_types: { custom_audience: 0, lookalike: 0 },
  };
  const baseWithoutExpansion = {
    custom_audiences: [{ id: "old" }],
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { custom_audience: 0, lookalike: 0 },
  };

  assert.deepEqual(applyAudienceInclusions(baseWithExpansion, []).targeting, {
    targeting_automation: { advantage_audience: 1 },
    targeting_relaxation_types: { custom_audience: 0, lookalike: 0 },
  });
  assert.deepEqual(applyAudienceInclusions(baseWithoutExpansion, []).targeting, {
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { custom_audience: 0, lookalike: 0 },
  });
});

test("clearing the last inclusion preserves an explicitly applied demographic limit", () => {
  const targeting = applyAudienceInclusions(
    { custom_audiences: [{ id: "old" }], targeting_automation: { advantage_audience: 0 } },
    [],
    { preserveManualAdvantage: true },
  ).targeting!;

  assert.equal(
    (targeting.targeting_automation as { advantage_audience?: number }).advantage_audience,
    0,
  );
  assert.deepEqual(targeting.targeting_relaxation_types, {
    custom_audience: 0,
    lookalike: 0,
  });
});

test("only integrity, permission and missing references block inclusion", () => {
  assert.deepEqual(validateAudienceInclusionIds(["same", "same"])[0]?.code, "AUDIENCE_INCLUSION_INVALID");
  const issues = validateAudienceInclusionsAgainstLibrary(
    ["blocked", "forbidden", "processing", "missing"],
    [
      audience("blocked", {
        availability: {
          include: "blocked",
          exclude: "available",
          lookalikeSource: "available",
          metaProcessing: "ready",
        },
      }),
      audience("forbidden", {
        capabilities: { ...audience("forbidden").capabilities, include: "unavailable" },
      }),
      audience("processing", {
        availability: {
          include: "unknown",
          exclude: "unknown",
          lookalikeSource: "unknown",
          metaProcessing: "processing",
        },
      }),
    ],
  );

  assert.deepEqual(
    issues.map((issue) => issue.code),
    [
      "AUDIENCE_INCLUSION_INTEGRITY_BLOCKED",
      "AUDIENCE_INCLUSION_UNAVAILABLE",
      "AUDIENCE_INCLUSION_NOT_FOUND",
    ],
  );
});

test("inclusions use OR semantics while exclusions keep precedence", () => {
  const included = applyAudienceInclusions(
    { geo_locations: { countries: ["BR"] } },
    ["instagram", "site", "lookalike"],
  );
  const combined = applyAudienceExclusions(included.targeting, ["site"]);

  assert.deepEqual(combined.issues, []);
  assert.deepEqual(combined.targeting?.custom_audiences, [
    { id: "instagram" },
    { id: "site" },
    { id: "lookalike" },
  ]);
  assert.deepEqual(combined.targeting?.excluded_custom_audiences, [{ id: "site" }]);
  assert.deepEqual(
    validateAppliedAudienceTargeting(combined.targeting, {
      includedCustomAudienceIds: ["instagram", "site", "lookalike"],
      excludedCustomAudienceIds: ["site"],
    }),
    [],
  );
});

test("audience facts report exclusion precedence without rejecting overlap", () => {
  assert.deepEqual(
    summarizeAudienceTargeting({
      custom_audiences: [{ id: "buyers" }, { id: "prospects" }],
      excluded_custom_audiences: [{ id: "buyers" }, { id: "old" }],
    }),
    {
      includedIds: ["buyers", "prospects"],
      excludedIds: ["buyers", "old"],
      effectiveIncludedIds: ["prospects"],
      overlappingIds: ["buyers"],
    },
  );
});

test("verification rejects inherited individual expansion suggestions", () => {
  const targeting = applyAudienceInclusions(
    {
      targeting_automation: {
        advantage_audience: 0,
        individual_setting: { age: true, gender: false },
      },
    },
    ["restricted"],
  ).targeting!;
  targeting.targeting_automation = {
    ...(targeting.targeting_automation as Record<string, unknown>),
    individual_setting: { age: true, gender: false },
  };

  assert.equal(
    validateAppliedAudienceTargeting(targeting, {
      includedCustomAudienceIds: ["restricted"],
    })[0]?.code,
    "AUDIENCE_TARGETING_VERIFY_FAILED",
  );
});

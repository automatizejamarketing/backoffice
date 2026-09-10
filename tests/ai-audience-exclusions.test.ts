import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAudienceExclusions,
  validateAudienceExclusionsAgainstLibrary,
} from "../lib/meta-business/marketing/ai-creation/audience-exclusions";
import { mergeAdSetTargeting } from "../lib/meta-business/marketing/update/update-ad-set";
import type { CustomAudienceView } from "../lib/meta-business/marketing/audiences/types";

function audience(
  id: string,
  overrides: Partial<CustomAudienceView> = {},
): CustomAudienceView {
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

test("audience exclusions replace only the exclusion field", () => {
  const base = {
    geo_locations: { countries: ["BR"] },
    custom_audiences: [{ id: "include-1" }],
    excluded_custom_audiences: [{ id: "old" }],
    targeting_automation: { advantage_audience: 1 },
    age_min: 25,
  };
  const result = applyAudienceExclusions(base, ["new-1", "new-2"]);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.targeting, {
    ...base,
    excluded_custom_audiences: [{ id: "new-1" }, { id: "new-2" }],
  });
  assert.deepEqual(base.excluded_custom_audiences, [{ id: "old" }]);
});

test("exclusion-only edits preserve existing expansion metadata", () => {
  const base = {
    targeting_automation: { advantage_audience: 1 },
    targeting_relaxation_types: { custom_audience: 0, lookalike: 1 },
    custom_audiences: [{ id: "include-1" }],
  };

  assert.deepEqual(applyAudienceExclusions(base, ["exclude-1"]).targeting, {
    ...base,
    excluded_custom_audiences: [{ id: "exclude-1" }],
  });
});

test("undefined preserves inherited exclusions and an empty list clears them", () => {
  const base = {
    excluded_custom_audiences: [{ id: "old" }],
    targeting_automation: { advantage_audience: 1 },
  };
  assert.deepEqual(applyAudienceExclusions(base, undefined).targeting, base);
  assert.deepEqual(applyAudienceExclusions(base, []).targeting, {
    targeting_automation: { advantage_audience: 1 },
  });
});

test("an explicit empty exclusion list survives the full targeting update", () => {
  const targeting = applyAudienceExclusions(
    { geo_locations: { countries: ["BR"] }, excluded_custom_audiences: [{ id: "old" }] },
    [],
  ).targeting!;
  const merged = mergeAdSetTargeting(
    { geo_locations: { countries: ["BR"] }, excluded_custom_audiences: [{ id: "old" }] } as never,
    undefined,
    targeting,
  );
  assert.equal("excluded_custom_audiences" in (merged ?? {}), false);
});

test("only known integrity or permission failures block selection", () => {
  const issues = validateAudienceExclusionsAgainstLibrary(
    ["blocked", "forbidden", "processing", "missing"],
    [
      audience("blocked", {
        availability: {
          include: "available",
          exclude: "blocked",
          lookalikeSource: "available",
          metaProcessing: "ready",
        },
      }),
      audience("forbidden", {
        capabilities: {
          ...audience("forbidden").capabilities,
          exclude: "unavailable",
        },
      }),
      audience("processing", {
        availability: {
          include: "available",
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
      "AUDIENCE_EXCLUSION_INTEGRITY_BLOCKED",
      "AUDIENCE_EXCLUSION_UNAVAILABLE",
      "AUDIENCE_EXCLUSION_NOT_FOUND",
    ],
  );
});

test("lookalike ineligibility does not block an available exclusion", () => {
  const issues = validateAudienceExclusionsAgainstLibrary(
    ["audience"],
    [
      audience("audience", {
        capabilities: {
          ...audience("audience").capabilities,
          exclude: "available",
          lookalikeSource: "unavailable",
        },
        availability: {
          include: "available",
          exclude: "available",
          lookalikeSource: "blocked",
          metaProcessing: "ready",
        },
      }),
    ],
  );

  assert.deepEqual(issues, []);
});

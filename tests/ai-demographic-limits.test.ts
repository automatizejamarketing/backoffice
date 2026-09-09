import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDemographicLimits,
  type DemographicLimits,
} from "@/lib/meta-business/marketing/ai-creation/demographic-limits";

test("demographic limits leave every inherited targeting difference untouched", () => {
  const base = {
    age_min: 21,
    age_max: 53,
    genders: [2],
    geo_locations: { countries: ["BR"] },
  };
  assert.deepEqual(applyDemographicLimits(base, undefined).targeting, base);
});

test("an applied age and gender replace only those fields and disable audience expansion", () => {
  const limits: DemographicLimits = { age: { min: 25, max: 44 }, genders: [1] };
  const result = applyDemographicLimits(
    { age_min: 18, age_max: 65, genders: [2], geo_locations: { countries: ["BR"] } },
    limits,
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.targeting, {
    age_min: 25,
    age_max: 44,
    genders: [1],
    geo_locations: { countries: ["BR"] },
    targeting_automation: { advantage_audience: 0 },
    targeting_relaxation_types: { custom_audience: 0, lookalike: 0 },
  });
});

test("restoring each field recomposes the current base without normalizing the other field", () => {
  const result = applyDemographicLimits(
    { age_min: 31, age_max: 52, genders: [2] },
    { age: null },
  );
  assert.deepEqual(result.targeting, { age_min: 31, age_max: 52, genders: [2] });
});

test("an incompatible demographic combination is reported before anything can activate", () => {
  const result = applyDemographicLimits({}, { age: { min: 44, max: 20 } });
  assert.equal(result.targeting, undefined);
  assert.equal(result.issues[0]?.code, "DEMOGRAPHIC_AGE_RANGE_INVALID");
});

import { afterEach, describe, expect, test } from "bun:test";
import {
  isMetaFakeScenarioEnvAllowed,
  isMetaFakeScenarioUser,
  parseMetaFakeScenarioUserIds,
} from "./config";

const ORIGINAL = {
  APP_ENV: process.env.APP_ENV,
  VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  META_FAKE_SCENARIO_USER_IDS: process.env.META_FAKE_SCENARIO_USER_IDS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("meta-fake config", () => {
  test("prod never allows fake scenarios", () => {
    expect(
      isMetaFakeScenarioEnvAllowed({
        APP_ENV: "prod",
        VERCEL_GIT_COMMIT_REF: "staging",
      }),
    ).toBe(false);
    expect(
      isMetaFakeScenarioEnvAllowed({
        APP_ENV: "production",
        VERCEL_GIT_COMMIT_REF: "staging",
      }),
    ).toBe(false);
  });

  test("staging and local allow fake scenarios", () => {
    expect(isMetaFakeScenarioEnvAllowed({ APP_ENV: "staging" })).toBe(true);
    expect(isMetaFakeScenarioEnvAllowed({ APP_ENV: "local" })).toBe(true);
    expect(
      isMetaFakeScenarioEnvAllowed({
        APP_ENV: "whatever",
        VERCEL_GIT_COMMIT_REF: "staging",
      }),
    ).toBe(true);
  });

  test("parses allowlist with exact UUID match only", () => {
    const ids = parseMetaFakeScenarioUserIds(
      " 11111111-1111-1111-1111-111111111111, 22222222-2222-2222-2222-222222222222 ",
    );
    expect(ids.has("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(ids.has("22222222-2222-2222-2222-222222222222")).toBe(true);
    expect(ids.has("11111111")).toBe(false);
  });

  test("isMetaFakeScenarioUser requires env allow + allowlist", () => {
    process.env.APP_ENV = "prod";
    process.env.META_FAKE_SCENARIO_USER_IDS =
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    expect(
      isMetaFakeScenarioUser("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    ).toBe(false);

    process.env.APP_ENV = "staging";
    expect(
      isMetaFakeScenarioUser("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    ).toBe(true);
    expect(
      isMetaFakeScenarioUser("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
    ).toBe(false);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { isMetaFakeScenarioUser } from "./config";

/**
 * Contract for the Meta boundary gate used by runPlaybookInsightsBatch:
 * only allowlisted staging/local users may take the fake path.
 */
describe("meta-fake adapter gate", () => {
  const ORIGINAL = {
    APP_ENV: process.env.APP_ENV,
    META_FAKE_SCENARIO_USER_IDS: process.env.META_FAKE_SCENARIO_USER_IDS,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("non-allowlisted users stay on the real Meta path", () => {
    process.env.APP_ENV = "staging";
    process.env.META_FAKE_SCENARIO_USER_IDS =
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    expect(
      isMetaFakeScenarioUser("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
    ).toBe(false);
  });

  test("allowlisted staging users take the fake path", () => {
    process.env.APP_ENV = "staging";
    process.env.META_FAKE_SCENARIO_USER_IDS =
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    expect(
      isMetaFakeScenarioUser("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    ).toBe(true);
  });

  test("production never takes the fake path even when allowlisted", () => {
    process.env.APP_ENV = "prod";
    process.env.META_FAKE_SCENARIO_USER_IDS =
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    expect(
      isMetaFakeScenarioUser("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    ).toBe(false);
  });
});

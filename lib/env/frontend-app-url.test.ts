import { describe, expect, test } from "bun:test";
import { resolveFrontendAppUrl } from "./frontend-app-url";

describe("resolveFrontendAppUrl", () => {
  test("normalizes bare prod domain to www", () => {
    expect(
      resolveFrontendAppUrl({
        FRONTEND_APP_URL: "https://automatizemarketing.com/",
      }),
    ).toBe("https://www.automatizemarketing.com");
  });

  test("uses staging fallback when env is staging and URL is missing", () => {
    expect(resolveFrontendAppUrl({ APP_ENV: "staging" })).toBe(
      "https://staging.automatizemarketing.com",
    );
  });

  test("prefers FRONTEND_URL when FRONTEND_APP_URL is empty", () => {
    expect(
      resolveFrontendAppUrl({
        APP_ENV: "staging",
        FRONTEND_APP_URL: "",
        FRONTEND_URL: "https://staging.automatizemarketing.com/",
      }),
    ).toBe("https://staging.automatizemarketing.com");
  });
});

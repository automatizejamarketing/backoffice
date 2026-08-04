import { afterEach, describe, expect, test } from "bun:test";
import { getAppUrl } from "./app-url";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getAppUrl", () => {
  test("prefers PORTLESS_URL over NEXTAUTH_URL", () => {
    process.env.PORTLESS_URL = "https://automatize-backoffice.localhost:1355/";
    process.env.NEXTAUTH_URL = "https://backoffice.automatizemarketing.com";

    const url = getAppUrl(
      new Request("http://127.0.0.1:4212/api/auth/magic-link"),
    );

    expect(url).toBe("https://automatize-backoffice.localhost:1355");
  });

  test("uses local request origin when Portless env is absent", () => {
    delete process.env.PORTLESS_URL;
    process.env.NEXTAUTH_URL = "https://backoffice.automatizemarketing.com";

    const url = getAppUrl(
      new Request("https://automatize-backoffice.localhost:1355/api/auth/magic-link"),
    );

    expect(url).toBe("https://automatize-backoffice.localhost:1355");
  });

  test("falls back to NEXTAUTH_URL outside local origins", () => {
    delete process.env.PORTLESS_URL;
    process.env.NEXTAUTH_URL = "https://backoffice.automatizemarketing.com";

    const url = getAppUrl(
      new Request("https://backoffice.automatizemarketing.com/api/auth/magic-link"),
    );

    expect(url).toBe("https://backoffice.automatizemarketing.com");
  });
});

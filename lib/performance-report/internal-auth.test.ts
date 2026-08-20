import { afterEach, describe, expect, test } from "bun:test";
import { assertMatReportAuthorized } from "./internal-auth";

const original = process.env.MAT_PERFORMANCE_REPORT_SECRET;

afterEach(() => {
  process.env.MAT_PERFORMANCE_REPORT_SECRET = original;
});

function requestWithBearer(token: string | null): Request {
  const headers = new Headers();
  if (token !== null) {
    headers.set("authorization", `Bearer ${token}`);
  }
  return new Request("https://backoffice.example/api/internal/mat-performance-report", {
    method: "POST",
    headers,
  });
}

describe("assertMatReportAuthorized", () => {
  test("rejects missing configuration", async () => {
    process.env.MAT_PERFORMANCE_REPORT_SECRET = "";
    const result = assertMatReportAuthorized(requestWithBearer("anything"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(500);
  });

  test("rejects a missing or wrong bearer token", async () => {
    process.env.MAT_PERFORMANCE_REPORT_SECRET = "super-secret";
    const missing = assertMatReportAuthorized(requestWithBearer(null));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.response.status).toBe(401);

    const wrong = assertMatReportAuthorized(requestWithBearer("nope"));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.response.status).toBe(401);
  });

  test("accepts the configured secret", () => {
    process.env.MAT_PERFORMANCE_REPORT_SECRET = "super-secret";
    expect(assertMatReportAuthorized(requestWithBearer("super-secret")).ok).toBe(
      true,
    );
  });
});

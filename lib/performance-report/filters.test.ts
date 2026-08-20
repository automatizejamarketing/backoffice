import { describe, expect, test } from "bun:test";
import { parseReportFilters } from "./filters";

describe("parseReportFilters", () => {
  test("defaults to last_30d and ignores unknown presets", () => {
    expect(parseReportFilters({}).datePreset).toBe("last_30d");
    expect(parseReportFilters({ datePreset: "lifetime" }).datePreset).toBe(
      "last_30d",
    );
  });

  test("rejects a half custom range", () => {
    expect(() => parseReportFilters({ since: "2026-08-01" })).toThrow(
      /since e until/,
    );
  });

  test("rejects non ISO dates", () => {
    expect(() =>
      parseReportFilters({ since: "01/08/2026", until: "20/08/2026" }),
    ).toThrow(/YYYY-MM-DD/);
  });

  test("accepts a complete custom window", () => {
    const filters = parseReportFilters({
      since: "2026-08-01",
      until: "2026-08-20",
      accountId: " act_1 ",
    });
    expect(filters.since).toBe("2026-08-01");
    expect(filters.until).toBe("2026-08-20");
    expect(filters.accountId).toBe("act_1");
  });
});

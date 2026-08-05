import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("finance page composition", () => {
  test("renders the navigation-dependent date filter inside its provider", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "page.tsx"),
      "utf8",
    );
    const providerStart = source.indexOf("<DashboardNavigationProvider>");
    const filter = source.indexOf("<DashboardDateFilter");
    const providerEnd = source.indexOf("</DashboardNavigationProvider>");

    expect(providerStart).toBeGreaterThan(-1);
    expect(filter).toBeGreaterThan(providerStart);
    expect(providerEnd).toBeGreaterThan(filter);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFinanceHref,
  resolveFinancePaymentSource,
  resolveFinanceTab,
} from "@/lib/backoffice/finance-search-params";

describe("finance page composition", () => {
  test("renders the navigation-dependent date filter inside its provider", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "page.tsx"),
      "utf8",
    );
    const providerStart = source.indexOf("<DashboardNavigationProvider>");
    const filter = source.indexOf("<FinanceDateFilter");
    const providerEnd = source.indexOf("</DashboardNavigationProvider>");

    expect(providerStart).toBeGreaterThan(-1);
    expect(filter).toBeGreaterThan(providerStart);
    expect(providerEnd).toBeGreaterThan(filter);
  });
});

describe("finance search params", () => {
  test("defaults to overview tab and automatize source", () => {
    expect(resolveFinanceTab({})).toBe("visao");
    expect(resolveFinancePaymentSource({})).toBe("automatize");
  });

  test("builds pagamentos urls with preserved date range", () => {
    expect(
      buildFinanceHref({
        tab: "pagamentos",
        source: "produtos",
        range: "custom",
        from: "2026-08-01",
        to: "2026-08-05",
      }),
    ).toBe(
      "/finance?tab=pagamentos&source=produtos&range=custom&from=2026-08-01&to=2026-08-05",
    );
  });
});

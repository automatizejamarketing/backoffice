import { describe, expect, test } from "bun:test";
import { resolveDashboardDateWindow } from "./dashboard-date-range";

describe("dashboard date range", () => {
  const now = new Date("2026-08-04T15:00:00.000Z");

  test("defaults to the last 30 Sao Paulo calendar days", () => {
    expect(resolveDashboardDateWindow({}, now)).toEqual({
      preset: "last_30_days",
      fromDate: "2026-07-06",
      throughDate: "2026-08-04",
      gte: new Date("2026-07-06T03:00:00.000Z"),
      lt: new Date("2026-08-05T03:00:00.000Z"),
    });
  });

  test("resolves this month and the complete previous month", () => {
    expect(resolveDashboardDateWindow({ range: "this_month" }, now)).toMatchObject({
      preset: "this_month",
      fromDate: "2026-08-01",
      throughDate: "2026-08-04",
    });
    expect(resolveDashboardDateWindow({ range: "last_month" }, now)).toMatchObject({
      preset: "last_month",
      fromDate: "2026-07-01",
      throughDate: "2026-07-31",
    });
  });

  test("accepts an arbitrary complete historical range", () => {
    expect(
      resolveDashboardDateWindow(
        { range: "custom", from: "2025-11-15", to: "2026-02-02" },
        now,
      ),
    ).toEqual({
      preset: "custom",
      fromDate: "2025-11-15",
      throughDate: "2026-02-02",
      gte: new Date("2025-11-15T03:00:00.000Z"),
      lt: new Date("2026-02-03T03:00:00.000Z"),
    });
  });

  test("falls back safely when a custom range is invalid or future-dated", () => {
    expect(
      resolveDashboardDateWindow(
        { range: "custom", from: "2026-08-10", to: "2026-08-11" },
        now,
      ).preset,
    ).toBe("last_30_days");
  });
});

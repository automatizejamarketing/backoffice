import { describe, expect, test } from "bun:test";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import {
  calendarDayCount,
  comparePlaybookAlertMetric,
  emptyPlaybookAlertKpis,
  fillDailyPlaybookAlertSeries,
  mostCommonRule,
  normalizePlaybookAlertFilters,
  playbookAlertHrefWith,
  playbookAlertStatusLabel,
  playbookAlertTabForStatus,
  previousEquivalentWindow,
  resolvePlaybookAlertAccessScope,
  sourceStatusesForPlaybookUpdate,
  statusesForPlaybookAlertTab,
  treatmentRate,
} from "./playbook-alert-dashboard";

const now = new Date("2026-08-04T15:00:00.000Z");

const admin: BackofficeActor = {
  id: "admin-1",
  email: "admin@example.com",
  role: "admin",
  source: "database",
};

const consultant: BackofficeActor = {
  id: "consultant-1",
  email: "consultant@example.com",
  role: "marketing_consultant",
  source: "database",
  assignedUserIds: ["user-1"],
};

describe("normalizePlaybookAlertFilters", () => {
  test("defaults to pending alerts in the last 30 Sao Paulo days", () => {
    const filters = normalizePlaybookAlertFilters({}, now);
    expect(filters.tab).toBe("pending");
    expect(filters.window.preset).toBe("last_30_days");
    expect(filters.window.fromDate).toBe("2026-07-06");
    expect(filters.window.throughDate).toBe("2026-08-04");
    expect(filters.search).toBe("");
    expect(filters.ruleId).toBe("all");
    expect(filters.severity).toBe("all");
    expect(filters.status).toBe("all");
    expect(filters.consultantId).toBe("all");
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(25);
  });

  test("accepts known values and ignores invalid ones", () => {
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";
    const filters = normalizePlaybookAlertFilters(
      {
        tab: "completed",
        q: ["  padaria  ", "ignored"],
        ruleId: "playbook.roas_trigger",
        severity: "critical",
        status: "done",
        consultantId: validUuid,
        page: "3",
        pageSize: "50",
      },
      now,
    );

    expect(filters.tab).toBe("completed");
    expect(filters.search).toBe("padaria");
    expect(filters.ruleId).toBe("playbook.roas_trigger");
    expect(filters.severity).toBe("critical");
    expect(filters.status).toBe("done");
    expect(filters.consultantId).toBe(validUuid);
    expect(filters.page).toBe(3);
    expect(filters.pageSize).toBe(50);
  });

  test("falls back when tab, rule, status or page are unknown", () => {
    const filters = normalizePlaybookAlertFilters(
      {
        tab: "inbox",
        ruleId: "drop.roas",
        severity: "urgent",
        status: "sent",
        page: "0",
        pageSize: "7",
        consultantId: "not-a-uuid",
      },
      now,
    );

    expect(filters.tab).toBe("pending");
    expect(filters.ruleId).toBe("all");
    expect(filters.severity).toBe("all");
    expect(filters.status).toBe("all");
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(25);
    expect(filters.consultantId).toBe("all");
  });
});

describe("previousEquivalentWindow", () => {
  test("uses the same number of calendar days immediately before", () => {
    const current = normalizePlaybookAlertFilters({}, now).window;
    expect(calendarDayCount(current.fromDate, current.throughDate)).toBe(30);

    const previous = previousEquivalentWindow(current);
    expect(previous.fromDate).toBe("2026-06-06");
    expect(previous.throughDate).toBe("2026-07-05");
    expect(calendarDayCount(previous.fromDate, previous.throughDate)).toBe(30);
  });
});

describe("playbook alert status grouping", () => {
  test("keeps pending and completed statuses distinct", () => {
    expect(playbookAlertTabForStatus("open")).toBe("pending");
    expect(playbookAlertTabForStatus("acknowledged")).toBe("pending");
    expect(playbookAlertTabForStatus("done")).toBe("completed");
    expect(playbookAlertTabForStatus("dismissed")).toBe("completed");
    expect(playbookAlertTabForStatus("resolved")).toBe("completed");
    expect(playbookAlertStatusLabel("resolved")).toBe(
      "Resolvido automaticamente",
    );
    expect(playbookAlertStatusLabel("done")).toBe("Concluído");
  });

  test("filters tab statuses and ignores a status from the other tab", () => {
    expect(statusesForPlaybookAlertTab("pending", "all")).toEqual([
      "open",
      "acknowledged",
    ]);
    expect(statusesForPlaybookAlertTab("pending", "acknowledged")).toEqual([
      "acknowledged",
    ]);
    expect(statusesForPlaybookAlertTab("pending", "done")).toEqual([
      "open",
      "acknowledged",
    ]);
    expect(statusesForPlaybookAlertTab("completed", "resolved")).toEqual([
      "resolved",
    ]);
  });

  test("allows concluding acknowledged alerts without changing acknowledge-only flow", () => {
    expect(sourceStatusesForPlaybookUpdate("acknowledged")).toEqual(["open"]);
    expect(sourceStatusesForPlaybookUpdate("done")).toEqual([
      "open",
      "acknowledged",
    ]);
    expect(sourceStatusesForPlaybookUpdate("dismissed")).toEqual([
      "open",
      "acknowledged",
    ]);
  });
});

describe("playbook alert metrics", () => {
  test("returns empty kpis and safe comparison without data", () => {
    expect(emptyPlaybookAlertKpis()).toEqual({
      created: 0,
      completed: 0,
      treatmentRate: 0,
    });
    expect(comparePlaybookAlertMetric(0, 0)).toEqual({
      current: 0,
      previous: 0,
      delta: 0,
      deltaPercent: 0,
    });
    expect(comparePlaybookAlertMetric(4, 0)).toEqual({
      current: 4,
      previous: 0,
      delta: 4,
      deltaPercent: null,
    });
    expect(treatmentRate(0, 0)).toBe(0);
    expect(treatmentRate(8, 2)).toBe(25);
    expect(mostCommonRule([])).toBeNull();
  });

  test("fills missing days in the selected window", () => {
    expect(
      fillDailyPlaybookAlertSeries(
        [{ date: "2026-08-03", created: 2, completed: 1 }],
        { fromDate: "2026-08-03", throughDate: "2026-08-04" },
      ),
    ).toEqual([
      { date: "2026-08-03", created: 2, completed: 1 },
      { date: "2026-08-04", created: 0, completed: 0 },
    ]);
  });
});

describe("resolvePlaybookAlertAccessScope", () => {
  test("locks consultants to their own portfolio", () => {
    expect(
      resolvePlaybookAlertAccessScope(consultant, "all"),
    ).toEqual({ kind: "consultant", consultantId: "consultant-1" });
    expect(
      resolvePlaybookAlertAccessScope(
        consultant,
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toEqual({ kind: "consultant", consultantId: "consultant-1" });
  });

  test("lets admins filter by consultant or unassigned accounts", () => {
    expect(resolvePlaybookAlertAccessScope(admin, "all")).toEqual({
      kind: "all",
    });
    expect(resolvePlaybookAlertAccessScope(admin, "unassigned")).toEqual({
      kind: "unassigned",
    });
    expect(
      resolvePlaybookAlertAccessScope(
        admin,
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toEqual({
      kind: "consultant_filter",
      consultantId: "550e8400-e29b-41d4-a716-446655440000",
    });
  });
});

describe("playbookAlertHrefWith", () => {
  test("resets page when switching tabs", () => {
    const filters = normalizePlaybookAlertFilters({ page: "3" }, now);
    expect(playbookAlertHrefWith(filters, { tab: "completed" })).toBe(
      "/alerts?tab=completed&range=last_30_days&from=2026-07-06&to=2026-08-04",
    );
  });
});

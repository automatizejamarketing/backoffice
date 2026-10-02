import { describe, expect, test } from "bun:test";
import { groupPlaybookAlerts } from "./playbook-alert-groups";

describe("groupPlaybookAlerts", () => {
  test("keeps all alerts of the same user together, even with equal client names", () => {
    const rows = [
      { id: "a", userId: "one", severity: "info", status: "open" },
      { id: "b", userId: "two", severity: "warning", status: "done" },
      { id: "c", userId: "one", severity: "critical", status: "acknowledged" },
      { id: "d", userId: "one", severity: "warning", status: "resolved" },
    ];
    const groups = groupPlaybookAlerts(rows);
    expect(groups.map((group) => group.userId)).toEqual(["one", "two"]);
    expect(groups[0].alerts.map((row) => row.id)).toEqual(["a", "c", "d"]);
    expect(groups[0].pendingIds).toEqual(["a", "c"]);
    expect(groups[0].severity).toBe("critical");
    expect(groups[1].pendingIds).toEqual([]);
  });

  test("handles an empty queue", () => {
    expect(groupPlaybookAlerts([])).toEqual([]);
  });
});

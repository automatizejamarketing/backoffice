import { describe, expect, test } from "bun:test";
import {
  defaultUsersTableColumnPrefs,
  moveUsersTableColumn,
  moveUsersTableColumnToIndex,
  parseUsersTableColumnPrefs,
  serializeUsersTableColumnPrefs,
  setUsersTableColumnVisible,
  visibleUsersTableColumns,
} from "./users-table-columns";

describe("users table columns", () => {
  test("keeps required user and actions columns when reading the old visible-only list", () => {
    const prefs = parseUsersTableColumnPrefs(
      JSON.stringify(["company", "phone", "plan"]),
    );

    expect(prefs.order[0]).toBe("user");
    expect(prefs.order.at(-1)).toBe("actions");
    expect(visibleUsersTableColumns(prefs)).toEqual([
      "user",
      "crmStatus",
      "company",
      "phone",
      "plan",
      "actions",
    ]);
  });

  test("reorders a column and persists the new order", () => {
    const moved = moveUsersTableColumn(
      defaultUsersTableColumnPrefs(),
      "crmStatus",
      1,
    );

    expect(moved.order.slice(0, 4)).toEqual([
      "user",
      "company",
      "crmStatus",
      "phone",
    ]);
    expect(
      parseUsersTableColumnPrefs(
        serializeUsersTableColumnPrefs(moved),
      ).order.slice(0, 4),
    ).toEqual(["user", "company", "crmStatus", "phone"]);
    expect(
      moveUsersTableColumnToIndex(
        defaultUsersTableColumnPrefs(),
        "actions",
        1,
      ).order.slice(0, 3),
    ).toEqual(["user", "actions", "crmStatus"]);
  });

  test("can hide optional columns but never user or actions", () => {
    const hidden = setUsersTableColumnVisible(
      defaultUsersTableColumnPrefs(),
      "crmStatus",
      false,
    );
    expect(visibleUsersTableColumns(hidden).includes("crmStatus")).toBe(false);

    const shown = setUsersTableColumnVisible(hidden, "crmStatus", true);
    expect(visibleUsersTableColumns(shown)[1]).toBe("crmStatus");

    expect(
      visibleUsersTableColumns(
        setUsersTableColumnVisible(shown, "user", false),
      ).includes("user"),
    ).toBe(true);
    expect(
      visibleUsersTableColumns(
        setUsersTableColumnVisible(shown, "actions", false),
      ).includes("actions"),
    ).toBe(true);
  });

  test("inserts user and actions into a stored optional-only order", () => {
    const prefs = parseUsersTableColumnPrefs(
      JSON.stringify({
        order: ["crmStatus", "company"],
        hidden: [],
      }),
    );

    expect(prefs.order[0]).toBe("user");
    expect(prefs.order.at(-1)).toBe("actions");
    expect(prefs.order.slice(1, 3)).toEqual(["crmStatus", "company"]);
  });
});

import { describe, expect, test } from "bun:test";
import { accountRowsFromTotals } from "./account-breakdown";

describe("accountRowsFromTotals", () => {
  const byAccount = new Map([
    ["act_1", { spend: 219.61, purchaseValue: 3096.68, purchases: 34 }],
    ["act_2", { spend: 24.28, purchaseValue: 57.99, purchases: 1 }],
    ["act_3", { spend: 0, purchaseValue: 0, purchases: 0 }],
  ]);
  const names = new Map([
    ["act_1", "CA 01 - Alpina Burguer"],
    ["act_2", "CA 02 - Alpina Burguer"],
  ]);

  test("principal first when the client has a selection, empty accounts dropped", () => {
    const rows = accountRowsFromTotals({ byAccount, order: ["act_2", "act_1"], names });
    expect(rows.map((row) => row.name)).toEqual([
      "CA 02 - Alpina Burguer",
      "CA 01 - Alpina Burguer",
    ]);
    expect(rows[1]?.roas).toBeCloseTo(14.1, 1);
  });

  test("without a selection, biggest spend first and ids as fallback names", () => {
    const rows = accountRowsFromTotals({
      byAccount: new Map([
        ["act_9", { spend: 10, purchaseValue: 0, purchases: 0 }],
        ["act_1", { spend: 50, purchaseValue: 100, purchases: 2 }],
      ]),
      order: null,
      names: new Map(),
    });
    expect(rows.map((row) => row.name)).toEqual(["act_1", "act_9"]);
    expect(rows[1]?.roas).toBe(0);
  });
});

import { describe, expect, test } from "bun:test";
import { evaluateDropsPerAccount, pickDropAccounts } from "./per-account";
import { evaluatePerformanceDrop } from "./evaluate";

const metrics = (spend: number, purchases: number, purchaseValue: number) => ({
  spend,
  purchases,
  purchaseValue,
  roas: spend > 0 ? purchaseValue / spend : 0,
});

describe("evaluateDropsPerAccount", () => {
  const healthy = {
    accountId: "act_1",
    accountName: "CA 01 - Alpina Burguer",
    previous: metrics(200, 30, 2800),
    current: metrics(220, 34, 3100),
  };
  const collapsing = {
    accountId: "act_2",
    accountName: "CA 02 - Alpina Burguer",
    previous: metrics(60, 6, 400),
    current: metrics(60, 1, 58),
  };

  test("a collapsing account is no longer hidden by a healthy one", () => {
    const summed = evaluatePerformanceDrop(
      metrics(260, 36, 3200),
      metrics(280, 35, 3158),
    );
    expect(summed.hasDrop).toBe(false);

    const drops = evaluateDropsPerAccount([healthy, collapsing]);
    expect(drops).toHaveLength(1);
    expect(drops[0]?.accountId).toBe("act_2");
    expect(drops[0]?.evaluation.severity).toBe("critical");
    expect(drops[0]?.title).toContain("· CA 02 - Alpina Burguer");
    expect(drops[0]?.evidence.startsWith("Conta CA 02 - Alpina Burguer: ")).toBe(true);
  });

  test("worst drop first", () => {
    const mild = { ...healthy, accountId: "act_3", current: metrics(200, 19, 1800) };
    const drops = evaluateDropsPerAccount([mild, collapsing]);
    expect(drops.map((drop) => drop.accountId)).toEqual(["act_2", "act_3"]);
  });

  test("single account keeps the original title and evidence", () => {
    const [drop] = evaluateDropsPerAccount([collapsing]);
    expect(drop?.title).toBe(drop?.evaluation.title);
    expect(drop?.evidence).toBe(drop?.evaluation.evidence);
  });

  test("each account must clear the spend floor on its own", () => {
    const tiny = { ...collapsing, previous: metrics(20, 4, 300), current: metrics(20, 0, 0) };
    expect(evaluateDropsPerAccount([healthy, tiny])).toEqual([]);
  });
});

describe("pickDropAccounts", () => {
  const visible = [
    { id: "act_1", account_id: "1" },
    { id: "act_2", account_id: "2" },
    { id: "act_3", account_id: "3" },
  ];

  test("enabled accounts only, principal first", () => {
    expect(pickDropAccounts({ visible, enabledIds: ["2", "1"] }).map((a) => a.id)).toEqual([
      "act_2",
      "act_1",
    ]);
  });

  test("no selection keeps every visible account", () => {
    expect(pickDropAccounts({ visible, enabledIds: [] })).toHaveLength(3);
  });
});

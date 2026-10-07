import { describe, expect, test } from "bun:test";
import {
  orderedEnabledAdAccountIds,
  pickEnabledVisibleAccounts,
} from "./enabled-ad-account-scope";

describe("orderedEnabledAdAccountIds", () => {
  test("principal first, prefix stripped, duplicates dropped", () => {
    expect(
      orderedEnabledAdAccountIds([
        { assetId: "act_1", isPrimary: false },
        { assetId: "2", isPrimary: true },
        { assetId: "1", isPrimary: false },
      ]),
    ).toEqual(["2", "1"]);
  });
});

describe("pickEnabledVisibleAccounts", () => {
  test("keeps enabled order and drops what the token does not see", () => {
    const visible = [
      { id: "act_1", account_id: "1" },
      { id: "act_2", account_id: "2" },
      { id: "act_3", account_id: "3" },
    ];
    const picked = pickEnabledVisibleAccounts({
      visible,
      enabledIds: ["3", "9", "act_1"],
      keysOf: (account) => [account.id, account.account_id],
    });
    expect(picked.map((account) => account.id)).toEqual(["act_3", "act_1"]);
  });
});

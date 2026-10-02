import { describe, expect, test } from "bun:test";
import { parseAlertCompletionIds } from "./playbook-alert-completion";

describe("parseAlertCompletionIds", () => {
  test("deduplicates selected alerts so a group completion does not count them twice", () => {
    expect(parseAlertCompletionIds(["alert-a", "alert-b", "alert-a"])).toEqual([
      "alert-a",
      "alert-b",
    ]);
  });
  test("rejects malformed or empty bulk requests rather than completing an entire account", () => {
    for (const value of [null, undefined, "all", [], [""], [" "], ["ok", 4]]) {
      expect(parseAlertCompletionIds(value)).toBeNull();
    }
  });
});

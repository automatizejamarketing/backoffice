import { describe, expect, test } from "bun:test";
import { PLAYBOOK_RECENT_SPEND_DAYS } from "./constants";
import { trailingInclusiveRange } from "./dates";

describe("trailingInclusiveRange", () => {
  test("covers today and the previous 9 calendar days in Sao Paulo", () => {
    const range = trailingInclusiveRange(
      new Date("2026-08-13T15:00:00.000Z"),
      PLAYBOOK_RECENT_SPEND_DAYS,
    );
    expect(range).toEqual({ since: "2026-08-04", until: "2026-08-13" });
  });
});

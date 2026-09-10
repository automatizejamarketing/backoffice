import { describe, expect, test } from "bun:test";
import { PLAYBOOK_RECENT_SPEND_DAYS } from "./constants";
import { adjacentInclusiveRanges, trailingInclusiveRange, wasCapturedOnPlaybookBusinessDay } from "./dates";

describe("trailingInclusiveRange", () => {
  test("covers today and the previous 9 calendar days in Sao Paulo", () => {
    const range = trailingInclusiveRange(
      new Date("2026-08-13T15:00:00.000Z"),
      PLAYBOOK_RECENT_SPEND_DAYS,
    );
    expect(range).toEqual({ since: "2026-08-04", until: "2026-08-13" });
  });
});

describe("adjacentInclusiveRanges", () => {
  test("compares last 7 days with the preceding 7 days", () => {
    const ranges = adjacentInclusiveRanges(
      new Date("2026-08-13T15:00:00.000Z"),
      7,
    );
    expect(ranges.current).toEqual({ since: "2026-08-07", until: "2026-08-13" });
    expect(ranges.previous).toEqual({ since: "2026-07-31", until: "2026-08-06" });
  });
});

describe("wasCapturedOnPlaybookBusinessDay", () => {
  test("uses America/Sao_Paulo calendar day, not UTC", () => {
    const latePreviousDay = new Date("2026-09-10T02:50:00.000Z"); // 23:50 BRT on the 9th
    const morning = new Date("2026-09-10T12:15:00.000Z"); // 09:15 BRT on the 10th
    expect(wasCapturedOnPlaybookBusinessDay(latePreviousDay, morning)).toBe(
      false,
    );
    expect(
      wasCapturedOnPlaybookBusinessDay(
        new Date("2026-09-10T12:20:00.000Z"),
        morning,
      ),
    ).toBe(true);
  });
});

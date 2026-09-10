import { describe, expect, test } from "bun:test";
import { rankPlaybookClaimQueue, type PlaybookClaimRow } from "./claim";

function row(
  userId: string,
  overrides: Partial<PlaybookClaimRow> = {},
): PlaybookClaimRow {
  return {
    userId,
    lastSuccessAt: null,
    attemptedToday: false,
    ...overrides,
  };
}

describe("rankPlaybookClaimQueue", () => {
  test("never-attempted today comes before same-day failures", () => {
    const ranked = rankPlaybookClaimQueue(
      [
        row("fail-today", { attemptedToday: true }),
        row("fresh"),
      ],
      2,
    );
    expect(ranked.map((item) => item.userId)).toEqual(["fresh", "fail-today"]);
  });

  test("never succeeded comes before an old success, which comes before a recent one", () => {
    const ranked = rankPlaybookClaimQueue(
      [
        row("yesterday", {
          lastSuccessAt: new Date("2026-09-09T12:00:00.000Z"),
        }),
        row("week-ago", {
          lastSuccessAt: new Date("2026-09-01T12:00:00.000Z"),
        }),
        row("never"),
      ],
      3,
    );
    expect(ranked.map((item) => item.userId)).toEqual([
      "never",
      "week-ago",
      "yesterday",
    ]);
  });

  test("caps the slice and uses a stable userId tie-break", () => {
    const ranked = rankPlaybookClaimQueue(
      [row("b"), row("a"), row("c")],
      2,
    );
    expect(ranked.map((item) => item.userId)).toEqual(["a", "b"]);
  });
});

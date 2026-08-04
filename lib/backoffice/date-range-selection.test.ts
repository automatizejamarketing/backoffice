import { describe, expect, test } from "bun:test";
import { resolveDateRangeSelection } from "./date-range-selection";

const augustSecond = new Date(2026, 7, 2, 12);
const augustThird = new Date(2026, 7, 3, 12);

describe("date range selection", () => {
  test("uses the first click only as the range start", () => {
    expect(
      resolveDateRangeSelection(undefined, {
        from: augustSecond,
        to: augustSecond,
      }),
    ).toEqual({
      draftRange: { from: augustSecond, to: undefined },
      isComplete: false,
    });
  });

  test("completes the range on the second click", () => {
    expect(
      resolveDateRangeSelection(
        { from: augustSecond, to: undefined },
        { from: augustSecond, to: augustThird },
      ),
    ).toEqual({
      draftRange: { from: augustSecond, to: augustThird },
      isComplete: true,
    });
  });
});

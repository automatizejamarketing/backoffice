import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAdSetScheduleUpdateParams,
  hasScheduleMinuteChange,
  toMinuteTimestamp,
} from "./budget-schedule";

const PAST_START = "2026-08-05T20:39:25-0300";
const FUTURE_START = "2099-01-10T09:00:00-0300";
const END = "2026-08-31T20:00:00-0300";
const LATER_END = "2026-09-30T20:00:00-0300";

function asParams(
  result: URLSearchParams | { error: string },
): URLSearchParams {
  assert.ok(!("error" in result), "expected params, got error");
  return result;
}

describe("toMinuteTimestamp / hasScheduleMinuteChange", () => {
  test("seconds are truncated — 20:39:25 equals 20:39:00", () => {
    assert.equal(
      toMinuteTimestamp("2026-08-05T20:39:25-0300"),
      toMinuteTimestamp("2026-08-05T20:39:00-0300"),
    );
    assert.equal(
      hasScheduleMinuteChange(
        "2026-08-05T20:39:25-0300",
        "2026-08-05T20:39:00-0300",
      ),
      false,
    );
  });

  test("a different minute is a change", () => {
    assert.equal(
      hasScheduleMinuteChange(
        "2026-08-05T20:39:00-0300",
        "2026-08-05T20:40:00-0300",
      ),
      true,
    );
  });
});

describe("buildAdSetScheduleUpdateParams", () => {
  test("budget-only save: drifted start on a STARTED ad set is ignored, not an error", () => {
    // The client's case: the campaign window differs from the duplicated ad
    // set's own start; the user changed neither start nor end.
    const result = buildAdSetScheduleUpdateParams(
      { start_time: PAST_START, end_time: END },
      "2026-08-11T11:30:00-0300", // campaign start ≠ ad set start
      END,
      { applyStart: false, applyEnd: false },
    );
    const params = asParams(result);
    assert.equal(params.size, 0);
  });

  test("user extended only the end: end propagates, start untouched", () => {
    const result = buildAdSetScheduleUpdateParams(
      { start_time: PAST_START, end_time: END },
      "2026-08-11T11:30:00-0300",
      LATER_END,
      { applyStart: false, applyEnd: true },
    );
    const params = asParams(result);
    assert.equal(params.get("start_time"), null);
    assert.equal(params.get("end_time"), new Date(LATER_END).toISOString());
  });

  test("user changed the start of a STARTED ad set: still refused", () => {
    const result = buildAdSetScheduleUpdateParams(
      { start_time: PAST_START, end_time: END },
      "2026-08-12T00:00:00-0300",
      END,
      { applyStart: true, applyEnd: false },
    );
    assert.ok("error" in result);
  });

  test("user changed the start of a FUTURE ad set: start propagates", () => {
    const nextStart = "2099-01-11T10:00:00-0300";
    const result = buildAdSetScheduleUpdateParams(
      { start_time: FUTURE_START, end_time: "2099-02-01T00:00:00-0300" },
      nextStart,
      "2099-02-01T00:00:00-0300",
      { applyStart: true, applyEnd: true },
    );
    const params = asParams(result);
    assert.equal(params.get("start_time"), new Date(nextStart).toISOString());
    assert.equal(params.get("end_time"), null);
  });

  test("defaults keep the per-ad-set behaviour (ABO paths): both ends compared", () => {
    const result = buildAdSetScheduleUpdateParams(
      { start_time: FUTURE_START, end_time: END },
      FUTURE_START,
      LATER_END,
    );
    const params = asParams(result);
    assert.equal(params.get("start_time"), null);
    assert.equal(params.get("end_time"), new Date(LATER_END).toISOString());
  });

  test("end equal at minute precision does not produce an update", () => {
    const result = buildAdSetScheduleUpdateParams(
      { start_time: PAST_START, end_time: "2026-08-31T20:00:33-0300" },
      PAST_START,
      "2026-08-31T20:00:00-0300",
      { applyStart: false, applyEnd: true },
    );
    const params = asParams(result);
    assert.equal(params.size, 0);
  });
});

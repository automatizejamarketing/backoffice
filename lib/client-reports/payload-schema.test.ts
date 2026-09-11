import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeMonthsPaidBack,
  resolveHeadlineState,
  spendBucket,
} from "./payload-schema";
import { lastCompleteWeek, previousWindow } from "./dates";

describe("client report math", () => {
  it("only shows months paid back with quality gates", () => {
    assert.deepEqual(
      computeMonthsPaidBack({
        cumulativeNetReturn: 900,
        monthlyPlanPrice: 297,
        daysOfData: 40,
        roasAdjusted: 1.4,
        purchases: 12,
      }),
      { months: 900 / 297, visible: true },
    );
    assert.equal(
      computeMonthsPaidBack({
        cumulativeNetReturn: 900,
        monthlyPlanPrice: 297,
        daysOfData: 10,
        roasAdjusted: 1.4,
        purchases: 12,
      }).visible,
      false,
    );
  });

  it("classifies headline from adjusted ROAS", () => {
    assert.equal(
      resolveHeadlineState({
        roasAdjusted: 2.1,
        purchaseValue: 800,
        spend: 200,
      }),
      "good",
    );
    assert.equal(
      resolveHeadlineState({
        roasAdjusted: 0.4,
        purchaseValue: 80,
        spend: 200,
      }),
      "bad",
    );
  });

  it("computes previous window and last week", () => {
    assert.deepEqual(previousWindow("2026-09-01", "2026-09-07"), {
      start: "2026-08-25",
      end: "2026-08-31",
    });
    const week = lastCompleteWeek(new Date("2026-09-10T12:00:00Z"));
    assert.equal(week.start, "2026-08-31");
    assert.equal(week.end, "2026-09-06");
  });

  it("buckets spend", () => {
    assert.equal(spendBucket(120), "0-500");
    assert.equal(spendBucket(900), "500-1500");
    assert.equal(spendBucket(5000), "4000+");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareWindows, EMPTY_WINDOW, pctChange, resolvePeriods, sortComparisons, sumWindows, type WindowTotals } from "./meta-ads-metrics";

// 2026-10-08 10:00 in Brasília.
const now = new Date("2026-10-08T13:00:00Z");
const w = (patch: Partial<WindowTotals>): WindowTotals => ({ ...EMPTY_WINDOW, ...patch });

describe("resolvePeriods", () => {
  it("defaults to the last 7 complete days and the 7 before them", () => {
    assert.deepEqual(resolvePeriods({}, now), {
      current: { since: "2026-10-01", until: "2026-10-07" },
      previous: { since: "2026-09-24", until: "2026-09-30" },
      days: 7, includesToday: false,
    });
  });
  it("uses the Brasília date, not UTC, near midnight", () => {
    // 2026-10-09 01:30 UTC is still 2026-10-08 in Brasília.
    assert.equal(resolvePeriods({ days: 1 }, new Date("2026-10-09T01:30:00Z")).current.until, "2026-10-07");
  });
  it("compares a custom range with the window right before it", () => {
    const p = resolvePeriods({ since: "2026-09-01", until: "2026-09-30" }, now);
    assert.deepEqual(p.previous, { since: "2026-08-02", until: "2026-08-31" });
    assert.equal(p.days, 30);
    assert.equal(resolvePeriods({ since: "2026-10-06", until: "2026-10-08" }, now).includesToday, true);
  });
  it("refuses invalid, inverted, future or oversized ranges", () => {
    assert.throws(() => resolvePeriods({ since: "2026-10-01" }, now), /juntos/);
    assert.throws(() => resolvePeriods({ since: "01/10/2026", until: "2026-10-02" }, now), /AAAA-MM-DD/);
    assert.throws(() => resolvePeriods({ since: "2026-10-05", until: "2026-10-01" }, now), /antes/);
    assert.throws(() => resolvePeriods({ since: "2026-10-01", until: "2026-10-09" }, now), /hoje/);
    assert.throws(() => resolvePeriods({ since: "2026-01-01", until: "2026-10-01" }, now), /90/);
    assert.throws(() => resolvePeriods({ days: 0 }, now), /days/);
  });
});

describe("pctChange", () => {
  it("is null without a base and signed otherwise", () => {
    assert.equal(pctChange(10, 0), null);
    assert.equal(pctChange(10, null), null);
    assert.equal(pctChange(null, 10), null);
    assert.equal(pctChange(150, 100), 50);
    assert.equal(pctChange(0, 80), -100);
    assert.equal(pctChange(1, 3), -66.7);
  });
});

describe("compareWindows", () => {
  it("derives cost per result and ROAS per window and their variation", () => {
    const c = compareWindows(
      w({ spend: 300, results: 30, purchases: 6, revenue: 900, impressions: 10_000, linkClicks: 150, campaignsWithSpend: 2 }),
      w({ spend: 200, results: 40, revenue: 800 }),
    );
    assert.equal(c.costPerResult, 10);
    assert.equal(c.costPerPurchase, 50);
    assert.equal(c.roas, 3);
    assert.equal(c.linkCtr, 1.5);
    assert.deepEqual(c.previous, { spend: 200, results: 40, costPerResult: 5, roas: 4 });
    assert.deepEqual(c.change, { spend: 50, results: -25, costPerResult: 100, roas: -25 });
  });
  it("has no ROAS or cost per result when there is nothing to divide", () => {
    const c = compareWindows(w({ spend: 50 }), EMPTY_WINDOW);
    assert.equal(c.roas, null);
    assert.equal(c.costPerResult, null);
    assert.deepEqual(c.change, { spend: null, results: null, costPerResult: null, roas: null });
  });
  it("reads a client that stopped selling as ROAS 0 (-100%), and one that never sells as no ROAS", () => {
    const stopped = compareWindows(w({ spend: 100 }), w({ spend: 100, revenue: 200 }));
    assert.equal(stopped.roas, 0);
    assert.equal(stopped.change.roas, -100);
    assert.equal(compareWindows(w({ spend: 100 }), w({ spend: 100 })).previous.roas, null);
  });
  it("sums windows field by field", () => {
    assert.deepEqual(sumWindows([w({ spend: 1, results: 2 }), w({ spend: 3, leads: 4 })]), w({ spend: 4, results: 2, leads: 4 }));
  });
});

describe("sortComparisons", () => {
  const row = (id: string, cur: Partial<WindowTotals>, prev: Partial<WindowTotals>) => ({ id, metrics: compareWindows(w(cur), w(prev)) });
  const rows = [
    row("a", { spend: 100, results: 10 }, { spend: 100, results: 20 }), // CPR +100%
    row("b", { spend: 500, results: 50 }, { spend: 400, results: 50 }), // CPR +25%
    row("c", { spend: 900 }, {}), // no CPR
    row("d", { spend: 50, results: 10 }, { spend: 100, results: 10 }), // CPR -50%
  ];
  it("puts the worst cost-per-result change first and rows without it last", () => {
    assert.deepEqual(sortComparisons(rows, "cost_per_result_change", "desc").map(r => r.id), ["a", "b", "d", "c"]);
    assert.deepEqual(sortComparisons(rows, "cost_per_result_change", "asc").map(r => r.id), ["d", "b", "a", "c"]);
  });
  it("sorts by spend", () => {
    assert.deepEqual(sortComparisons(rows, "spend", "desc").map(r => r.id), ["c", "b", "a", "d"]);
  });
});

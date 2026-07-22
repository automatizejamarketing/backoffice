import { describe, expect, test } from "bun:test";
import { evaluatePerformanceDrop } from "@/lib/performance-drop/evaluate";

describe("evaluatePerformanceDrop", () => {
  test("flags critical ROAS drop ≥ 50%", () => {
    const result = evaluatePerformanceDrop(
      { spend: 200, purchases: 20, purchaseValue: 1000, roas: 5 },
      { spend: 180, purchases: 8, purchaseValue: 360, roas: 2 },
    );
    expect(result.hasDrop).toBe(true);
    expect(result.severity).toBe("critical");
    expect(result.metric).toBe("roas");
  });

  test("flags warning purchase drop ≥ 30%", () => {
    const result = evaluatePerformanceDrop(
      { spend: 200, purchases: 20, purchaseValue: 800, roas: 4 },
      { spend: 200, purchases: 12, purchaseValue: 720, roas: 3.6 },
    );
    expect(result.hasDrop).toBe(true);
    expect(result.severity).toBe("warning");
    expect(result.metric).toBe("purchases");
  });

  test("skips when previous spend is below sample floor", () => {
    const result = evaluatePerformanceDrop(
      { spend: 10, purchases: 5, purchaseValue: 50, roas: 5 },
      { spend: 10, purchases: 0, purchaseValue: 0, roas: 0 },
    );
    expect(result.hasDrop).toBe(false);
    expect(result.sampleInsufficient).toBe(true);
  });
});

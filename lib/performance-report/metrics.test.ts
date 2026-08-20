import { describe, expect, test } from "bun:test";
import { metricsFromInsight } from "./metrics";

describe("metricsFromInsight", () => {
  test("prefers pixel purchase over omni when both exist", () => {
    const metrics = metricsFromInsight({
      spend: "100",
      impressions: "1000",
      clicks: "20",
      actions: [
        { action_type: "omni_purchase", value: "1" },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
      ],
      action_values: [
        { action_type: "omni_purchase", value: "50" },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "180" },
      ],
      purchase_roas: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "1.8" },
      ],
      date_start: "2026-08-01",
      date_stop: "2026-08-20",
    });

    expect(metrics.purchases).toBe(3);
    expect(metrics.purchaseValue).toBe(180);
    expect(metrics.roas).toBe(1.8);
    expect(metrics.cpa).toBeCloseTo(100 / 3);
    expect(metrics.dateStart).toBe("2026-08-01");
  });

  test("derives purchase value from ROAS when Meta omits action_values", () => {
    const metrics = metricsFromInsight({
      spend: "50",
      purchase_roas: [{ action_type: "purchase", value: "2" }],
    });
    expect(metrics.purchaseValue).toBe(100);
    expect(metrics.roas).toBe(2);
  });
});

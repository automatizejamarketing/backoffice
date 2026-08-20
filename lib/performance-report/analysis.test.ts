import { describe, expect, test } from "bun:test";

import {
  allocatePlanCost,
  analyticalTagFromDelivery,
  billingCycleDays,
  calendarDaysExclusive,
  calendarDaysInclusive,
  computeRoasPair,
  derivedCpa,
  derivedRoas,
  groupCreatives,
  isHudVisibleCampaign,
  mapHudDelivery,
  paymentAmountReais,
  sampleCaveat,
  sortCampaignsNewestFirst,
  windowDays,
} from "./analysis";

describe("HUD delivery and analytical tags", () => {
  test("ACTIVE effective status is ATIVA even if we never look at the toggle", () => {
    expect(mapHudDelivery("ACTIVE")).toBe("active");
    expect(analyticalTagFromDelivery("active")).toBe("ATIVA");
  });

  test("toggle-on but PAUSED delivery is PAUSADA", () => {
    expect(mapHudDelivery("PAUSED")).toBe("inactive");
    expect(analyticalTagFromDelivery("inactive")).toBe("PAUSADA");
  });

  test("elapsed stop_time is Concluído → PAUSADA even if Graph still says ACTIVE", () => {
    const past = "2026-01-01T00:00:00.000Z";
    expect(mapHudDelivery("ACTIVE", past, Date.parse("2026-08-13T12:00:00.000Z"))).toBe(
      "completed",
    );
    expect(analyticalTagFromDelivery("completed")).toBe("PAUSADA");
  });

  test("future stop_time does not complete an ACTIVE campaign", () => {
    const future = "2026-12-01T00:00:00.000Z";
    expect(mapHudDelivery("ACTIVE", future, Date.parse("2026-08-13T12:00:00.000Z"))).toBe(
      "active",
    );
  });

  test("pending review stays EM ANÁLISE", () => {
    expect(mapHudDelivery("PENDING_REVIEW")).toBe("pending");
    expect(mapHudDelivery("IN_PROCESS")).toBe("pending");
    expect(mapHudDelivery("PREAPPROVED")).toBe("pending");
    expect(analyticalTagFromDelivery("pending")).toBe("EM ANÁLISE");
  });

  test("DISAPPROVED and WITH_ISSUES are inactive → PAUSADA", () => {
    expect(mapHudDelivery("DISAPPROVED")).toBe("inactive");
    expect(mapHudDelivery("WITH_ISSUES")).toBe("inactive");
    expect(analyticalTagFromDelivery("inactive")).toBe("PAUSADA");
  });

  test("archived/deleted are not HUD-visible", () => {
    expect(isHudVisibleCampaign("ARCHIVED")).toBe(false);
    expect(isHudVisibleCampaign("DELETED")).toBe(false);
    expect(isHudVisibleCampaign("ACTIVE")).toBe(true);
    expect(isHudVisibleCampaign("PENDING_REVIEW")).toBe(true);
  });
});

describe("campaign sort", () => {
  test("sorts newest start date first, not by ROAS or spend", () => {
    const sorted = sortCampaignsNewestFirst([
      {
        name: "old high roas",
        startTime: "2026-01-01T00:00:00.000Z",
      },
      {
        name: "new low roas",
        startTime: "2026-08-01T00:00:00.000Z",
      },
      {
        name: "mid",
        createdTime: "2026-04-01T00:00:00.000Z",
      },
    ]);
    expect(sorted.map((row) => row.name)).toEqual([
      "new low roas",
      "mid",
      "old high roas",
    ]);
  });
});

describe("window and billing cycle", () => {
  test("inclusive calendar days", () => {
    expect(calendarDaysInclusive("2026-08-01", "2026-08-30")).toBe(30);
    expect(calendarDaysInclusive("2026-08-13", "2026-08-13")).toBe(1);
  });

  test("exclusive calendar days for billing periods", () => {
    expect(calendarDaysExclusive("2026-07-13", "2026-08-12")).toBe(30);
    expect(calendarDaysExclusive("2026-07-01", "2026-08-01")).toBe(31);
  });

  test("windowDays prefers insight dates then preset", () => {
    expect(
      windowDays({
        dateStart: "2026-08-01",
        dateStop: "2026-08-07",
        datePreset: "last_30d",
      }),
    ).toBe(7);
    expect(windowDays({ datePreset: "last_30d" })).toBe(30);
    expect(windowDays({ datePreset: "last_7d" })).toBe(7);
  });

  test("billingCycleDays uses period dates then commitment months", () => {
    expect(
      billingCycleDays({
        periodStart: "2026-07-13",
        periodEnd: "2026-08-12",
      }),
    ).toBe(30);
    expect(billingCycleDays({ commitmentMonths: 1 })).toBe(30);
    expect(billingCycleDays({})).toBe(30);
  });
});

describe("adjusted ROAS", () => {
  test("computes Meta and Automatize-adjusted ROAS side by side", () => {
    const allocated = allocatePlanCost({
      planAmountReais: paymentAmountReais(29_700),
      billingCycleDays: 30,
      windowDays: 30,
    });
    expect(allocated).toBe(297);
    const pair = computeRoasPair({
      purchaseValue: 10_000,
      spend: 900,
      allocatedPlanCost: allocated,
      spendCurrency: "BRL",
      planCurrency: "brl",
      hasPayment: true,
    });
    expect(pair.roasMeta).toBeCloseTo(10_000 / 900);
    expect(pair.roasAdjusted).toBeCloseTo(10_000 / (900 + 297));
    expect(pair.unavailableReason).toBeNull();
  });

  test("prorates plan cost for a 7-day window", () => {
    const allocated = allocatePlanCost({
      planAmountReais: 297,
      billingCycleDays: 30,
      windowDays: 7,
    });
    expect(allocated).toBeCloseTo(297 * (7 / 30));
  });

  test("uses one full monthly payment for a standard 30-day report", () => {
    const allocated = allocatePlanCost({
      planAmountReais: 297,
      billingCycleDays: 32,
      windowDays: 30,
    });
    expect(allocated).toBe(297);
  });

  test("missing payment leaves Meta ROAS and explains adjusted", () => {
    const pair = computeRoasPair({
      purchaseValue: 1000,
      spend: 100,
      allocatedPlanCost: null,
      spendCurrency: "BRL",
      planCurrency: null,
      hasPayment: false,
    });
    expect(pair.roasMeta).toBe(10);
    expect(pair.roasAdjusted).toBeNull();
    expect(pair.unavailableReason).toBe("missing_payment");
  });

  test("currency mismatch blocks adjusted ROAS", () => {
    const pair = computeRoasPair({
      purchaseValue: 1000,
      spend: 100,
      allocatedPlanCost: 297,
      spendCurrency: "USD",
      planCurrency: "BRL",
      hasPayment: true,
    });
    expect(pair.roasMeta).toBe(10);
    expect(pair.roasAdjusted).toBeNull();
    expect(pair.unavailableReason).toBe("currency_mismatch");
  });

  test("zero spend blocks both useful ROAS values", () => {
    const pair = computeRoasPair({
      purchaseValue: 500,
      spend: 0,
      allocatedPlanCost: 297,
      spendCurrency: "BRL",
      planCurrency: "BRL",
      hasPayment: true,
    });
    expect(pair.roasMeta).toBeNull();
    expect(pair.roasAdjusted).toBeNull();
    expect(pair.unavailableReason).toBe("zero_spend");
  });

  test("zero purchases yields CPA null and ROAS 0", () => {
    expect(derivedCpa({ spend: 80, purchases: 0, purchaseValue: 0, impressions: 10, clicks: 1 })).toBeNull();
    expect(derivedRoas({ spend: 80, purchases: 0, purchaseValue: 0, impressions: 10, clicks: 1 })).toBe(0);
  });
});

describe("creatives and sample size", () => {
  test("groups ads by creative and recomputes metrics", () => {
    const grouped = groupCreatives([
      {
        id: "ad1",
        name: "Ad 1",
        campaignId: "c1",
        campaignName: "Camp 1",
        creativeId: "cr1",
        creativeName: "Burger",
        spend: 100,
        purchases: 4,
        purchaseValue: 400,
        cpa: 25,
        roas: 4,
      },
      {
        id: "ad2",
        name: "Ad 2",
        campaignId: "c2",
        campaignName: "Camp 2",
        creativeId: "cr1",
        creativeName: "Burger",
        spend: 50,
        purchases: 1,
        purchaseValue: 80,
        cpa: 50,
        roas: 1.6,
      },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.spend).toBe(150);
    expect(grouped[0]?.purchases).toBe(5);
    expect(grouped[0]?.purchaseValue).toBe(480);
    expect(grouped[0]?.cpa).toBeCloseTo(30);
    expect(grouped[0]?.roas).toBeCloseTo(480 / 150);
    expect(grouped[0]?.campaignIds).toEqual(["c1", "c2"]);
  });

  test("limited vs robust sample caveats", () => {
    expect(sampleCaveat({ spend: 50, purchases: 2 })).toBe("limited");
    expect(sampleCaveat({ spend: 400, purchases: 12 })).toBe("robust");
    expect(sampleCaveat({ spend: 150, purchases: 5 })).toBe("moderate");
  });
});

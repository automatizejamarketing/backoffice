import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BUSINESS_OPERATING_RULES,
  evaluateBusinessHealth,
  getBusinessRuleChanges,
} from "./business-health";

const now = new Date("2026-05-20T12:00:00.000Z");

function baseInput(
  overrides: Partial<Parameters<typeof evaluateBusinessHealth>[0]> = {},
): Parameters<typeof evaluateBusinessHealth>[0] {
  return {
    referenceDate: now,
    rules: DEFAULT_BUSINESS_OPERATING_RULES,
    subscriptionStatus: "active",
    renewalDate: new Date("2026-06-20T12:00:00.000Z"),
    credits: 100,
    onboardingCompleted: true,
    lastAiUsageAt: new Date("2026-05-19T12:00:00.000Z"),
    lastPostAt: null,
    hasActiveManagedCampaign: false,
    ...overrides,
  };
}

describe("evaluateBusinessHealth", () => {
  test("marks renewal inside the critical window as critical", () => {
    const result = evaluateBusinessHealth(
      baseInput({ renewalDate: new Date("2026-05-22T12:00:00.000Z") }),
    );

    expect(result.status).toBe("critical");
    expect(
      result.reasons.some((reason) => reason.code === "renewal_critical"),
    ).toBe(true);
  });

  test("honors custom inactivity windows", () => {
    const result = evaluateBusinessHealth(
      baseInput({
        rules: {
          ...DEFAULT_BUSINESS_OPERATING_RULES,
          inactivityAttentionDays: 5,
        },
        lastAiUsageAt: new Date("2026-05-15T12:00:00.000Z"),
        lastPostAt: null,
      }),
    );

    expect(result.status).toBe("attention");
    expect(result.reasons.some((reason) => reason.code === "inactive")).toBe(
      true,
    );
  });

  test("does not mark inactivity when a managed Meta campaign is active", () => {
    const result = evaluateBusinessHealth(
      baseInput({
        lastAiUsageAt: new Date("2026-04-01T12:00:00.000Z"),
        lastPostAt: null,
        hasActiveManagedCampaign: true,
      }),
    );

    expect(result.status).toBe("healthy");
    expect(result.reasons.some((reason) => reason.code === "inactive")).toBe(
      false,
    );
    expect(result.activityShieldedByManagedCampaign).toBe(true);
  });

  test("keeps non-inactivity alerts even when a managed campaign is active", () => {
    const result = evaluateBusinessHealth(
      baseInput({
        credits: 0,
        lastAiUsageAt: new Date("2026-04-01T12:00:00.000Z"),
        lastPostAt: null,
        hasActiveManagedCampaign: true,
      }),
    );

    expect(result.status).toBe("critical");
    expect(
      result.reasons.some((reason) => reason.code === "credits_empty"),
    ).toBe(true);
    expect(result.reasons.some((reason) => reason.code === "inactive")).toBe(
      false,
    );
  });
});

describe("getBusinessRuleChanges", () => {
  test("returns field-level changes for business rule audit logs", () => {
    const changes = getBusinessRuleChanges(DEFAULT_BUSINESS_OPERATING_RULES, {
      ...DEFAULT_BUSINESS_OPERATING_RULES,
      inactivityAttentionDays: 5,
      managedCampaignNamePrefix: "[AJ]",
    });

    expect(JSON.stringify(changes)).toBe(JSON.stringify([
      {
        fieldName: "inactivityAttentionDays",
        oldValue: "14",
        newValue: "5",
      },
      {
        fieldName: "managedCampaignNamePrefix",
        oldValue: "[AM]",
        newValue: "[AJ]",
      },
    ]));
  });
});

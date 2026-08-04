import { describe, expect, test } from "bun:test";
import {
  filterBusinessPortfolioItems,
  normalizePortfolioFilterParams,
} from "./portfolio-filters";
import type { BusinessPortfolioItem } from "@/lib/db/business-queries";

function item(
  overrides: Partial<BusinessPortfolioItem> &
    Pick<BusinessPortfolioItem, "userId" | "userEmail">,
): BusinessPortfolioItem {
  return {
    userImageUrl: null,
    userPhone: null,
    credits: 0,
    expirationDate: null,
    companyName: null,
    onboardingCompleted: false,
    consultantId: null,
    consultantEmail: null,
    consultantName: null,
    subscriptionStatus: null,
    subscriptionPlanType: null,
    subscriptionCurrentPeriodEnd: null,
    subscriptionCancelAtPeriodEnd: false,
    metaAccountName: null,
    metaUpdatedAt: null,
    lastAiUsageAt: null,
    lastPostAt: null,
    postCount: 0,
    hasActiveManagedCampaign: false,
    managedCampaignNames: [],
    managedCampaignCheckedAt: null,
    managedCampaignError: null,
    health: {
      status: "healthy",
      reasons: [],
      nextAction: "Monitorar",
      daysUntilRenewal: null,
      daysSinceLastActivity: null,
      lastActivityAt: null,
      activityShieldedByManagedCampaign: false,
    },
    ...overrides,
  };
}

describe("normalizePortfolioFilterParams", () => {
  test("defaults unknown values to all", () => {
    expect(
      normalizePortfolioFilterParams({
        subscriptionStatus: "weird",
        campaignStatus: "nope",
      }),
    ).toEqual({
      consultantId: "all",
      subscriptionStatus: "all",
      campaignStatus: "all",
      search: "",
    });
  });

  test("validates consultantId like users filters", () => {
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";

    expect(
      normalizePortfolioFilterParams({ consultantId: "unassigned" }).consultantId,
    ).toBe("unassigned");
    expect(
      normalizePortfolioFilterParams({ consultantId: validUuid }).consultantId,
    ).toBe(validUuid);
    expect(
      normalizePortfolioFilterParams({ consultantId: "not-a-uuid" }).consultantId,
    ).toBe("all");
  });

  test("handles repeated query params without throwing", () => {
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";

    expect(
      normalizePortfolioFilterParams({
        q: ["  padaria  ", "ignored"],
        subscriptionStatus: ["active", "trialing"],
        campaignStatus: ["inactive", "active"],
        consultantId: [validUuid, "bad"],
      }),
    ).toEqual({
      consultantId: validUuid,
      subscriptionStatus: "active",
      campaignStatus: "inactive",
      search: "padaria",
    });
  });
});

describe("filterBusinessPortfolioItems", () => {
  const accounts = [
    item({
      userId: "1",
      userEmail: "ativo@example.com",
      companyName: "Padaria Ativa",
      subscriptionStatus: "active",
      hasActiveManagedCampaign: true,
    }),
    item({
      userId: "2",
      userEmail: "trial@example.com",
      companyName: "Trial Shop",
      subscriptionStatus: "trialing",
      hasActiveManagedCampaign: false,
      managedCampaignCheckedAt: new Date("2026-01-15"),
    }),
    item({
      userId: "3",
      userEmail: "cancelado@example.com",
      companyName: "Ex Cliente",
      subscriptionStatus: "canceled",
      hasActiveManagedCampaign: false,
      managedCampaignCheckedAt: new Date("2026-01-01"),
    }),
    item({
      userId: "4",
      userEmail: "never-checked@example.com",
      companyName: "Nunca Checado",
      subscriptionStatus: "active",
      hasActiveManagedCampaign: false,
      managedCampaignCheckedAt: null,
    }),
  ];

  test("filters by subscription status", () => {
    expect(
      filterBusinessPortfolioItems(accounts, {
        consultantId: "all",
        subscriptionStatus: "active",
        campaignStatus: "all",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["1", "4"]);

    expect(
      filterBusinessPortfolioItems(accounts, {
        consultantId: "all",
        subscriptionStatus: "trialing",
        campaignStatus: "all",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["2"]);

    expect(
      filterBusinessPortfolioItems(accounts, {
        consultantId: "all",
        subscriptionStatus: "canceled",
        campaignStatus: "all",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["3"]);
  });

  test("filters by campaign status", () => {
    expect(
      filterBusinessPortfolioItems(accounts, {
        consultantId: "all",
        subscriptionStatus: "all",
        campaignStatus: "active",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["1"]);

    expect(
      filterBusinessPortfolioItems(accounts, {
        consultantId: "all",
        subscriptionStatus: "all",
        campaignStatus: "inactive",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["2", "3"]);
  });

  test("filters by consultant", () => {
    const consultantUuid = "550e8400-e29b-41d4-a716-446655440000";
    const withConsultants = [
      item({
        userId: "a",
        userEmail: "assigned@example.com",
        consultantId: consultantUuid,
      }),
      item({
        userId: "b",
        userEmail: "unassigned@example.com",
        consultantId: null,
      }),
    ];

    expect(
      filterBusinessPortfolioItems(withConsultants, {
        consultantId: consultantUuid,
        subscriptionStatus: "all",
        campaignStatus: "all",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["a"]);

    expect(
      filterBusinessPortfolioItems(withConsultants, {
        consultantId: "unassigned",
        subscriptionStatus: "all",
        campaignStatus: "all",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["b"]);
  });

  test("filters by search text", () => {
    expect(
      filterBusinessPortfolioItems(accounts, {
        consultantId: "all",
        subscriptionStatus: "all",
        campaignStatus: "all",
        search: "padaria",
      }).map((row) => row.userId),
    ).toEqual(["1"]);
  });
});

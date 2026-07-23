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
    }),
    item({
      userId: "3",
      userEmail: "cancelado@example.com",
      companyName: "Ex Cliente",
      subscriptionStatus: "canceled",
      hasActiveManagedCampaign: false,
    }),
  ];

  test("filters by subscription status", () => {
    expect(
      filterBusinessPortfolioItems(accounts, {
        subscriptionStatus: "active",
        campaignStatus: "all",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["1"]);

    expect(
      filterBusinessPortfolioItems(accounts, {
        subscriptionStatus: "trialing",
        campaignStatus: "all",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["2"]);

    expect(
      filterBusinessPortfolioItems(accounts, {
        subscriptionStatus: "canceled",
        campaignStatus: "all",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["3"]);
  });

  test("filters by campaign status", () => {
    expect(
      filterBusinessPortfolioItems(accounts, {
        subscriptionStatus: "all",
        campaignStatus: "active",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["1"]);

    expect(
      filterBusinessPortfolioItems(accounts, {
        subscriptionStatus: "all",
        campaignStatus: "inactive",
        search: "",
      }).map((row) => row.userId),
    ).toEqual(["2", "3"]);
  });

  test("filters by search text", () => {
    expect(
      filterBusinessPortfolioItems(accounts, {
        subscriptionStatus: "all",
        campaignStatus: "all",
        search: "padaria",
      }).map((row) => row.userId),
    ).toEqual(["1"]);
  });
});

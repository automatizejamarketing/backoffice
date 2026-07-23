import type { BusinessPortfolioItem } from "@/lib/db/business-queries";
import {
  firstSearchParam,
  normalizeConsultantFilterId,
} from "@/lib/backoffice/filter-params";

export const PORTFOLIO_SUBSCRIPTION_STATUS_FILTER_VALUES = [
  "all",
  "active",
  "trialing",
  "canceled",
] as const;

export const PORTFOLIO_CAMPAIGN_STATUS_FILTER_VALUES = [
  "all",
  "active",
  "inactive",
] as const;

export type PortfolioSubscriptionStatusFilter =
  (typeof PORTFOLIO_SUBSCRIPTION_STATUS_FILTER_VALUES)[number];

export type PortfolioCampaignStatusFilter =
  (typeof PORTFOLIO_CAMPAIGN_STATUS_FILTER_VALUES)[number];

export type PortfolioFilterParams = {
  consultantId: string | "all" | "unassigned";
  subscriptionStatus: PortfolioSubscriptionStatusFilter;
  campaignStatus: PortfolioCampaignStatusFilter;
  search: string;
};

function isPortfolioSubscriptionStatusFilter(
  value: string,
): value is PortfolioSubscriptionStatusFilter {
  return (
    PORTFOLIO_SUBSCRIPTION_STATUS_FILTER_VALUES as readonly string[]
  ).includes(value);
}

function isPortfolioCampaignStatusFilter(
  value: string,
): value is PortfolioCampaignStatusFilter {
  return (
    PORTFOLIO_CAMPAIGN_STATUS_FILTER_VALUES as readonly string[]
  ).includes(value);
}

export function normalizePortfolioFilterParams(input: {
  consultantId?: string | string[];
  subscriptionStatus?: string | string[];
  campaignStatus?: string | string[];
  q?: string | string[];
}): PortfolioFilterParams {
  const consultantId = normalizeConsultantFilterId(input.consultantId);
  const subscriptionStatusRaw =
    firstSearchParam(input.subscriptionStatus)?.trim() || "all";
  const campaignStatusRaw =
    firstSearchParam(input.campaignStatus)?.trim() || "all";
  const search = firstSearchParam(input.q)?.trim() ?? "";

  return {
    consultantId,
    subscriptionStatus: isPortfolioSubscriptionStatusFilter(
      subscriptionStatusRaw,
    )
      ? subscriptionStatusRaw
      : "all",
    campaignStatus: isPortfolioCampaignStatusFilter(campaignStatusRaw)
      ? campaignStatusRaw
      : "all",
    search,
  };
}

export function filterBusinessPortfolioItems(
  items: BusinessPortfolioItem[],
  filters: Pick<
    PortfolioFilterParams,
    "consultantId" | "subscriptionStatus" | "campaignStatus" | "search"
  >,
): BusinessPortfolioItem[] {
  const search = filters.search.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.consultantId === "unassigned") {
      if (item.consultantId != null) return false;
    } else if (filters.consultantId !== "all") {
      if (item.consultantId !== filters.consultantId) return false;
    }

    if (filters.subscriptionStatus !== "all") {
      if (item.subscriptionStatus !== filters.subscriptionStatus) {
        return false;
      }
    }

    if (filters.campaignStatus === "active") {
      if (item.hasActiveManagedCampaign !== true) return false;
    } else if (filters.campaignStatus === "inactive") {
      if (
        item.managedCampaignCheckedAt === null ||
        item.hasActiveManagedCampaign
      ) {
        return false;
      }
    }

    if (search.length > 0) {
      const haystack = [
        item.userEmail,
        item.companyName ?? "",
        item.consultantEmail ?? "",
        item.consultantName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });
}

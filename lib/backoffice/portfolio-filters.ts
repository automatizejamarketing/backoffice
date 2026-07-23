import type { BusinessPortfolioItem } from "@/lib/db/business-queries";

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
  consultantId?: string;
  subscriptionStatus?: string;
  campaignStatus?: string;
  q?: string;
}): PortfolioFilterParams {
  const consultantId = input.consultantId?.trim() || "all";
  const subscriptionStatusRaw = input.subscriptionStatus?.trim() || "all";
  const campaignStatusRaw = input.campaignStatus?.trim() || "all";
  const search = input.q?.trim() ?? "";

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
    "subscriptionStatus" | "campaignStatus" | "search"
  >,
): BusinessPortfolioItem[] {
  const search = filters.search.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.subscriptionStatus !== "all") {
      if (item.subscriptionStatus !== filters.subscriptionStatus) {
        return false;
      }
    }

    if (filters.campaignStatus === "active") {
      if (!item.hasActiveManagedCampaign) return false;
    } else if (filters.campaignStatus === "inactive") {
      if (item.hasActiveManagedCampaign) return false;
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

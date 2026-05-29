import type { DatePreset, TimeIncrement } from "@/lib/meta-business/types";
import type { CampaignObjectiveFilter } from "@/lib/meta-business/campaign-objectives";
import type {
  CampaignSortMetric,
  SortOrder,
} from "@/lib/meta-business/campaign-sort";

/**
 * Shared, hierarchical React Query keys for the backoffice Meta Marketing flows.
 *
 * Unlike the user-facing app, the backoffice impersonates end-users, so the
 * Meta token is selected by `userId`. Every key therefore carries BOTH the ad
 * `accountId` and the `userId` scope to keep one impersonated user's cache from
 * leaking into another's.
 */

export type CampaignListFilters = {
  datePreset?: DatePreset | null;
  since?: string | null;
  until?: string | null;
  objectiveFilter?: CampaignObjectiveFilter;
  sortMetric?: CampaignSortMetric | null;
  sortOrder?: SortOrder;
};

export type AdSetListFilters = {
  campaignId?: string | null;
  datePreset?: DatePreset | null;
  since?: string | null;
  until?: string | null;
  cursor?: string | null;
};

export type AdListFilters = {
  adSetId?: string | null;
  datePreset?: DatePreset | null;
  since?: string | null;
  until?: string | null;
  cursor?: string | null;
};

export type InsightsRange = {
  timeIncrement?: TimeIncrement | null;
  datePreset?: DatePreset | null;
  since?: string | null;
  until?: string | null;
};

export const marketingKeys = {
  all: (accountId: string, userId: string) =>
    ["meta-marketing", accountId, userId] as const,

  // Campaigns
  campaignListRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "campaigns", "list"] as const,
  campaignList: (
    accountId: string,
    userId: string,
    filters: CampaignListFilters,
  ) =>
    [...marketingKeys.campaignListRoot(accountId, userId), filters] as const,
  campaignDetailRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "campaigns", "detail"] as const,
  campaignDetail: (accountId: string, userId: string, campaignId: string) =>
    [...marketingKeys.campaignDetailRoot(accountId, userId), campaignId] as const,
  campaignInsightsRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "campaigns", "insights"] as const,
  campaignInsights: (
    accountId: string,
    userId: string,
    campaignId: string,
    range: InsightsRange,
  ) =>
    [
      ...marketingKeys.campaignInsightsRoot(accountId, userId),
      campaignId,
      range,
    ] as const,

  // Ad sets
  adsetListRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "adsets", "list"] as const,
  adsetList: (accountId: string, userId: string, filters: AdSetListFilters) =>
    [...marketingKeys.adsetListRoot(accountId, userId), filters] as const,
  adsetDetailRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "adsets", "detail"] as const,
  adsetDetail: (
    accountId: string,
    userId: string,
    adsetId: string,
    adsLimit: number,
  ) =>
    [...marketingKeys.adsetDetailRoot(accountId, userId), adsetId, adsLimit] as const,
  adsetInsightsRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "adsets", "insights"] as const,
  adsetInsights: (
    accountId: string,
    userId: string,
    adsetId: string,
    range: InsightsRange,
  ) =>
    [
      ...marketingKeys.adsetInsightsRoot(accountId, userId),
      adsetId,
      range,
    ] as const,
  adsetEditHistory: (accountId: string, userId: string, adsetId: string) =>
    [...marketingKeys.all(accountId, userId), "adsets", "edit-history", adsetId] as const,

  // Ads
  adListRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "ads", "list"] as const,
  adList: (accountId: string, userId: string, filters: AdListFilters) =>
    [...marketingKeys.adListRoot(accountId, userId), filters] as const,
  promotionLinkRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "ads", "promotion-link"] as const,
  promotionLink: (accountId: string, userId: string, adId: string) =>
    [...marketingKeys.promotionLinkRoot(accountId, userId), adId] as const,
};

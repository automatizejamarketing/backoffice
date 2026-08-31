import type { MetaTrackingEntityLevel } from "@/lib/db/schema";
import type { DatePreset, TimeIncrement } from "@/lib/meta-business/types";
import type { CampaignObjectiveFilter } from "@/lib/meta-business/campaign-objectives";
import type { SortOrder } from "@/lib/meta-business/campaign-sort";
import type { CampaignMetricId } from "../utils/campaign-metrics";

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
  sortMetric?: CampaignMetricId | null;
  sortOrder?: SortOrder;
};

export type AdSetListFilters = {
  campaignId?: string | null;
  datePreset?: DatePreset | null;
  since?: string | null;
  until?: string | null;
  cursor?: string | null;
  sortMetric?: CampaignMetricId | null;
  sortOrder?: SortOrder;
};

export type AdListFilters = {
  adSetId?: string | null;
  datePreset?: DatePreset | null;
  since?: string | null;
  until?: string | null;
  cursor?: string | null;
  sortMetric?: CampaignMetricId | null;
  sortOrder?: SortOrder;
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
    includeConversion: boolean,
  ) =>
    [
      ...marketingKeys.adsetDetailRoot(accountId, userId),
      adsetId,
      adsLimit,
      includeConversion ? "conversion" : "basic",
    ] as const,
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

  /**
   * Histórico unificado de ações (stream de tracking). Fica sob a raiz da conta
   * de propósito: toda mutação invalida `marketingKeys.all`, então o painel
   * recarrega sozinho assim que uma alteração é aplicada.
   */
  trackingHistory: (
    accountId: string,
    userId: string,
    entityLevel: MetaTrackingEntityLevel,
    entityId: string,
  ) =>
    [
      ...marketingKeys.all(accountId, userId),
      "tracking-history",
      entityLevel,
      entityId,
    ] as const,

  // Ads
  adListRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "ads", "list"] as const,
  adList: (accountId: string, userId: string, filters: AdListFilters) =>
    [...marketingKeys.adListRoot(accountId, userId), filters] as const,
  promotionLinkRoot: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "ads", "promotion-link"] as const,
  promotionLink: (accountId: string, userId: string, adId: string) =>
    [...marketingKeys.promotionLinkRoot(accountId, userId), adId] as const,
  creativeDiagnoses: (accountId: string, userId: string) =>
    [...marketingKeys.all(accountId, userId), "creative-diagnoses"] as const,

  // Facebook Pages (ad identity selector)
  pages: (accountId: string, userId: string) =>
    ["marketing-pages", accountId, userId] as const,
};

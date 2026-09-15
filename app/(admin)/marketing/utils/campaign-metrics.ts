"use client";

import {
  CampaignObjective,
  type Campaign,
  type InsightsMetrics,
} from "@/lib/meta-business/types";

export type CampaignMetricId =
  | "spend"
  | "impressions"
  | "clicks"
  | "reach"
  | "cpc"
  | "ctr"
  | "cpm"
  | "purchaseRoas"
  | "purchaseCost"
  | "purchaseValue"
  | "purchaseCount"
  | "linkClicks"
  | "landingPageViews"
  | "leadCost"
  | "leadCount"
  | "addToCartCount"
  | "initiateCheckoutCount"
  | "cartAbandonmentCount"
  | "costPerResult"
  | "messagingConversationCount"
  | "messagingConversationCost"
  | "messagingNewContactCount"
  | "messagingNewContactCost"
  | "messagingBlockedCount"
  | "messagingSubscriptionCount";

export type CampaignMetricFormat =
  | "currency"
  | "number"
  | "percentage"
  | "roas";

export type CampaignMetricSurface = "mobileList" | "desktopList" | "detailCards" | "chart";

export type CampaignMetricDefinition = {
  id: CampaignMetricId;
  format: CampaignMetricFormat;
  labelKey: string;
};

export type CampaignMetricBucket =
  | "sales"
  | "traffic"
  | "leads"
  | "messaging"
  | "default";

const SALES_OBJECTIVES = new Set<CampaignObjective>([
  CampaignObjective.OUTCOME_SALES,
  CampaignObjective.CONVERSIONS,
  CampaignObjective.PRODUCT_CATALOG_SALES,
]);

const TRAFFIC_OBJECTIVES = new Set<CampaignObjective>([
  CampaignObjective.OUTCOME_TRAFFIC,
  CampaignObjective.LINK_CLICKS,
]);

const LEADS_OBJECTIVES = new Set<CampaignObjective>([
  CampaignObjective.OUTCOME_LEADS,
  CampaignObjective.LEAD_GENERATION,
]);

export const CAMPAIGN_METRIC_DEFINITIONS: Record<
  CampaignMetricId,
  CampaignMetricDefinition
> = {
  spend: { id: "spend", format: "currency", labelKey: "spend" },
  impressions: { id: "impressions", format: "number", labelKey: "impressions" },
  clicks: { id: "clicks", format: "number", labelKey: "clicks" },
  reach: { id: "reach", format: "number", labelKey: "reach" },
  cpc: { id: "cpc", format: "currency", labelKey: "cpc" },
  ctr: { id: "ctr", format: "percentage", labelKey: "ctr" },
  cpm: { id: "cpm", format: "currency", labelKey: "cpm" },
  purchaseRoas: { id: "purchaseRoas", format: "roas", labelKey: "roas" },
  purchaseCost: { id: "purchaseCost", format: "currency", labelKey: "cpa" },
  purchaseValue: {
    id: "purchaseValue",
    format: "currency",
    labelKey: "purchaseValue",
  },
  purchaseCount: {
    id: "purchaseCount",
    format: "number",
    labelKey: "numberOfPurchases",
  },
  linkClicks: { id: "linkClicks", format: "number", labelKey: "linkClicks" },
  landingPageViews: {
    id: "landingPageViews",
    format: "number",
    labelKey: "landingPageViews",
  },
  leadCost: { id: "leadCost", format: "currency", labelKey: "cpl" },
  leadCount: {
    id: "leadCount",
    format: "number",
    labelKey: "numberOfLeads",
  },
  addToCartCount: {
    id: "addToCartCount",
    format: "number",
    labelKey: "addToCart",
  },
  initiateCheckoutCount: {
    id: "initiateCheckoutCount",
    format: "number",
    labelKey: "checkout",
  },
  cartAbandonmentCount: {
    id: "cartAbandonmentCount",
    format: "number",
    labelKey: "cartAbandonment",
  },
  costPerResult: {
    id: "costPerResult",
    format: "currency",
    labelKey: "costPerResult",
  },
  messagingConversationCount: {
    id: "messagingConversationCount",
    format: "number",
    labelKey: "messagingConversations",
  },
  messagingConversationCost: {
    id: "messagingConversationCost",
    format: "currency",
    labelKey: "costPerMessagingConversation",
  },
  messagingNewContactCount: {
    id: "messagingNewContactCount",
    format: "number",
    labelKey: "messagingNewContacts",
  },
  messagingNewContactCost: {
    id: "messagingNewContactCost",
    format: "currency",
    labelKey: "costPerMessagingNewContact",
  },
  messagingBlockedCount: {
    id: "messagingBlockedCount",
    format: "number",
    labelKey: "messagingBlocked",
  },
  messagingSubscriptionCount: {
    id: "messagingSubscriptionCount",
    format: "number",
    labelKey: "messagingSubscriptions",
  },
};

export const MARKETING_TABLE_METRIC_IDS: CampaignMetricId[] = [
  "spend",
  "purchaseRoas",
  "costPerResult",
  "purchaseCost",
  "leadCost",
  "messagingConversationCost",
  "messagingNewContactCost",
  "cpc",
  "cpm",
  "ctr",
  "purchaseValue",
  "purchaseCount",
  "cartAbandonmentCount",
  "initiateCheckoutCount",
  "addToCartCount",
  "linkClicks",
  "landingPageViews",
  "leadCount",
  "messagingConversationCount",
  "messagingNewContactCount",
  "messagingBlockedCount",
  "messagingSubscriptionCount",
  "impressions",
  "reach",
  "clicks",
];

export const MARKETING_TABLE_METRIC_OPTIONS =
  MARKETING_TABLE_METRIC_IDS.map((metricId) => CAMPAIGN_METRIC_DEFINITIONS[metricId]);

const METRIC_GROUPS: Record<CampaignMetricBucket, Record<CampaignMetricSurface, CampaignMetricId[]>> = {
  sales: {
    mobileList: ["purchaseRoas", "purchaseCost", "purchaseValue", "purchaseCount"],
    desktopList: [
      "purchaseRoas",
      "purchaseCost",
      "purchaseValue",
      "purchaseCount",
      "spend",
    ],
    detailCards: [
      "purchaseRoas",
      "purchaseCost",
      "purchaseValue",
      "purchaseCount",
      "spend",
      "impressions",
      "ctr",
    ],
    chart: [
      "purchaseRoas",
      "purchaseCost",
      "purchaseValue",
      "purchaseCount",
      "spend",
    ],
  },
  traffic: {
    mobileList: ["linkClicks", "cpc", "ctr", "landingPageViews"],
    desktopList: ["linkClicks", "cpc", "ctr", "landingPageViews", "spend"],
    detailCards: [
      "linkClicks",
      "cpc",
      "ctr",
      "landingPageViews",
      "costPerResult",
      "spend",
      "impressions",
      "cpm",
    ],
    chart: ["linkClicks", "cpc", "ctr", "landingPageViews", "spend"],
  },
  leads: {
    mobileList: ["leadCost", "leadCount", "spend", "ctr"],
    desktopList: ["leadCost", "leadCount", "spend", "ctr", "impressions"],
    detailCards: [
      "leadCost",
      "leadCount",
      "spend",
      "impressions",
      "ctr",
      "cpc",
      "cpm",
    ],
    chart: ["leadCost", "leadCount", "spend", "ctr"],
  },
  messaging: {
    mobileList: [
      "messagingConversationCount",
      "messagingConversationCost",
      "messagingNewContactCount",
      "spend",
    ],
    desktopList: [
      "messagingConversationCount",
      "messagingConversationCost",
      "messagingNewContactCount",
      "messagingNewContactCost",
      "spend",
    ],
    detailCards: [
      "messagingConversationCount",
      "messagingConversationCost",
      "messagingNewContactCount",
      "messagingNewContactCost",
      "messagingBlockedCount",
      "messagingSubscriptionCount",
      "spend",
      "impressions",
    ],
    chart: [
      "messagingConversationCount",
      "messagingConversationCost",
      "messagingNewContactCount",
      "messagingNewContactCost",
      "messagingBlockedCount",
      "messagingSubscriptionCount",
      "spend",
    ],
  },
  default: {
    mobileList: ["spend", "impressions", "clicks", "cpc"],
    desktopList: ["spend", "impressions", "clicks", "cpc", "cpm"],
    detailCards: ["spend", "impressions", "clicks", "reach", "cpc", "ctr", "cpm"],
    chart: ["spend", "impressions", "clicks", "cpc", "cpm"],
  },
};

/**
 * Which default metric set an object shows.
 *
 * `isMessaging` wins over the objective: under ODAX a WhatsApp campaign is
 * OUTCOME_SALES / OUTCOME_LEADS / OUTCOME_ENGAGEMENT, and reading only the
 * objective is what used to show purchase columns on a campaign whose result
 * is a conversation. The flag is derived server-side (`Campaign.isMessaging`,
 * `AdSet.isMessaging`) from the ad set configuration and Meta's own result.
 */
export function getCampaignMetricBucket(
  objective?: CampaignObjective,
  isMessaging?: boolean,
): CampaignMetricBucket {
  if (isMessaging) return "messaging";
  if (!objective) return "default";
  if (SALES_OBJECTIVES.has(objective)) return "sales";
  if (TRAFFIC_OBJECTIVES.has(objective)) return "traffic";
  if (LEADS_OBJECTIVES.has(objective)) return "leads";
  return "default";
}

export function getCampaignMetricsForObjective(
  objective: CampaignObjective | undefined,
  surface: CampaignMetricSurface,
  isMessaging?: boolean,
): CampaignMetricDefinition[] {
  const bucket = getCampaignMetricBucket(objective, isMessaging);
  return METRIC_GROUPS[bucket][surface].map(
    (metricId) => CAMPAIGN_METRIC_DEFINITIONS[metricId],
  );
}

export function getCampaignMetricsForCampaign(
  campaign: Campaign,
  surface: CampaignMetricSurface,
): CampaignMetricDefinition[] {
  return getCampaignMetricsForObjective(
    campaign.objective,
    surface,
    campaign.isMessaging,
  );
}

export function getMetricDefinitionsFromIds(
  metricIds: readonly CampaignMetricId[],
): CampaignMetricDefinition[] {
  return metricIds
    .map((metricId) => CAMPAIGN_METRIC_DEFINITIONS[metricId])
    .filter((metric): metric is CampaignMetricDefinition => Boolean(metric));
}

export function resolveCampaignTableMetrics(
  objective: CampaignObjective | undefined,
  surface: CampaignMetricSurface,
  selectedMetricIds?: readonly CampaignMetricId[] | null,
  isMessaging?: boolean,
): CampaignMetricDefinition[] {
  if (!selectedMetricIds || selectedMetricIds.length === 0) {
    return getCampaignMetricsForObjective(objective, surface, isMessaging);
  }

  const customMetrics = getMetricDefinitionsFromIds(selectedMetricIds);
  return customMetrics.length > 0
    ? customMetrics
    : getCampaignMetricsForObjective(objective, surface, isMessaging);
}

export function getMetricRawValue(
  insights: InsightsMetrics | undefined,
  metricId: CampaignMetricId,
): string | undefined {
  if (!insights) return undefined;

  switch (metricId) {
    case "spend":
      return insights.spend;
    case "impressions":
      return insights.impressions;
    case "clicks":
      return insights.clicks;
    case "reach":
      return insights.reach;
    case "cpc":
      return insights.cpc;
    case "ctr":
      return insights.ctr;
    case "cpm":
      return insights.cpm;
    case "purchaseRoas":
      return insights.purchaseRoas ?? insights.websitePurchaseRoas;
    case "purchaseCost":
      return insights.purchaseCost;
    case "purchaseValue":
      return insights.purchaseValue;
    case "purchaseCount":
      return insights.purchaseCount;
    case "linkClicks":
      return insights.linkClicks;
    case "landingPageViews":
      return insights.landingPageViews;
    case "leadCost":
      return insights.leadCost;
    case "leadCount":
      return insights.leadCount;
    case "addToCartCount":
      return insights.addToCartCount;
    case "initiateCheckoutCount":
      return insights.initiateCheckoutCount;
    case "cartAbandonmentCount":
      return insights.cartAbandonmentCount;
    case "costPerResult":
      return insights.costPerResult;
    case "messagingConversationCount":
      return insights.messagingConversationCount;
    case "messagingConversationCost":
      return insights.messagingConversationCost;
    case "messagingNewContactCount":
      return insights.messagingNewContactCount;
    case "messagingNewContactCost":
      return insights.messagingNewContactCost;
    case "messagingBlockedCount":
      return insights.messagingBlockedCount;
    case "messagingSubscriptionCount":
      return insights.messagingSubscriptionCount;
    default:
      return undefined;
  }
}

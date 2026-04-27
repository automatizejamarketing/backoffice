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
  | "leadCount";

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

export type CampaignMetricBucket = "sales" | "traffic" | "leads" | "default";

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
};

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
  default: {
    mobileList: ["spend", "impressions", "clicks", "cpc"],
    desktopList: ["spend", "impressions", "clicks", "cpc", "cpm"],
    detailCards: ["spend", "impressions", "clicks", "reach", "cpc", "ctr", "cpm"],
    chart: ["spend", "impressions", "clicks", "cpc", "cpm"],
  },
};

export function getCampaignMetricBucket(
  objective?: CampaignObjective,
): CampaignMetricBucket {
  if (!objective) return "default";
  if (SALES_OBJECTIVES.has(objective)) return "sales";
  if (TRAFFIC_OBJECTIVES.has(objective)) return "traffic";
  if (LEADS_OBJECTIVES.has(objective)) return "leads";
  return "default";
}

export function getCampaignMetricsForObjective(
  objective: CampaignObjective | undefined,
  surface: CampaignMetricSurface,
): CampaignMetricDefinition[] {
  const bucket = getCampaignMetricBucket(objective);
  return METRIC_GROUPS[bucket][surface].map(
    (metricId) => CAMPAIGN_METRIC_DEFINITIONS[metricId],
  );
}

export function getCampaignMetricsForCampaign(
  campaign: Campaign,
  surface: CampaignMetricSurface,
): CampaignMetricDefinition[] {
  return getCampaignMetricsForObjective(campaign.objective, surface);
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
    default:
      return undefined;
  }
}

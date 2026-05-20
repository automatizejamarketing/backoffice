"use client";

import type { InsightsMetrics } from "@/lib/meta-business/types";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "./formatters";
import {
  getMetricRawValue,
  type CampaignMetricDefinition,
} from "./campaign-metrics";

export function formatRoas(value: string | undefined): string {
  if (!value) return "-";

  const numValue = Number.parseFloat(value);
  if (Number.isNaN(numValue)) return "-";

  return `${numValue.toFixed(2)}x`;
}

export function formatMetricValue(
  metric: CampaignMetricDefinition,
  insights?: InsightsMetrics,
): string {
  const rawValue = getMetricRawValue(insights, metric.id);

  switch (metric.format) {
    case "currency":
      return formatCurrency(rawValue);
    case "percentage":
      return formatPercentage(rawValue);
    case "roas":
      return formatRoas(rawValue);
    case "number":
    default:
      return formatNumber(rawValue);
  }
}

const METRIC_LABELS: Record<string, string> = {
  spend: "Gasto",
  impressions: "Impressões",
  clicks: "Cliques",
  reach: "Alcance",
  cpc: "CPC",
  ctr: "CTR",
  cpm: "CPM",
  roas: "ROAS",
  cpa: "CPA",
  purchaseValue: "Valor de compra",
  numberOfPurchases: "Compras",
  linkClicks: "Cliques no link",
  landingPageViews: "Views da página",
  cpl: "CPL",
  numberOfLeads: "Leads",
};

export function getMetricLabel(labelKey: string): string {
  return METRIC_LABELS[labelKey] ?? labelKey;
}

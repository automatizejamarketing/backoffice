/**
 * Metrics the "Ordenar por" selector exposes. Restricted to core Ads Insights
 * fields that the Meta Insights edge can sort server-side via the `sort`
 * parameter. Derived/action-based metrics (ROAS, purchases, leads, link
 * clicks, ...) are intentionally excluded — Meta cannot sort by those.
 */
export type CampaignSortMetric =
  | "spend"
  | "impressions"
  | "clicks"
  | "reach"
  | "cpc"
  | "ctr"
  | "cpm";

export type SortOrder = "asc" | "desc";

export type CampaignSortOption = {
  id: CampaignSortMetric;
  label: string;
  /** Field name used in the Insights edge `sort` token. */
  metaField: string;
};

export const CAMPAIGN_SORT_OPTIONS: CampaignSortOption[] = [
  { id: "spend", label: "Gasto", metaField: "spend" },
  { id: "impressions", label: "Impressões", metaField: "impressions" },
  { id: "clicks", label: "Cliques", metaField: "clicks" },
  { id: "reach", label: "Alcance", metaField: "reach" },
  { id: "cpc", label: "CPC", metaField: "cpc" },
  { id: "ctr", label: "CTR", metaField: "ctr" },
  { id: "cpm", label: "CPM", metaField: "cpm" },
];

const SORT_OPTION_BY_ID = new Map(
  CAMPAIGN_SORT_OPTIONS.map((option) => [option.id, option]),
);

export function isCampaignSortMetric(
  value: string | null | undefined,
): value is CampaignSortMetric {
  return value != null && SORT_OPTION_BY_ID.has(value as CampaignSortMetric);
}

export function isSortOrder(
  value: string | null | undefined,
): value is SortOrder {
  return value === "asc" || value === "desc";
}

/**
 * Builds the Meta Insights `sort` token, e.g. `spend_descending`.
 * Reference: GET /act_<id>/insights?sort=["spend_descending"].
 */
export function buildInsightsSortToken(
  metric: CampaignSortMetric,
  order: SortOrder,
): string {
  const option = SORT_OPTION_BY_ID.get(metric);
  const field = option?.metaField ?? metric;
  return `${field}_${order === "desc" ? "descending" : "ascending"}`;
}

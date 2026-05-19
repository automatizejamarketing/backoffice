/**
 * Metrics the "Ordenar por" selector exposes, sorted server-side by the Meta
 * Ads Insights edge via the `sort` parameter (`{field}_descending`).
 *
 * Besides the core scalar fields, Meta also exposes the objective-defined
 * `results` / `cost_per_result` and the `purchase_roas` fields on the
 * account-level insights endpoint (`/act_<id>/insights` with `level=campaign`),
 * so those are sortable too. `results`/`cost_per_result` are resolved by Meta
 * per campaign from its optimization goal (same value Ads Manager shows).
 */
export type CampaignSortMetric =
  | "spend"
  | "impressions"
  | "clicks"
  | "reach"
  | "cpc"
  | "ctr"
  | "cpm"
  | "results"
  | "costPerResult"
  | "purchaseRoas";

export type SortOrder = "asc" | "desc";

export type CampaignSortOption = {
  id: CampaignSortMetric;
  label: string;
  /** Field name used in the Insights edge `sort` token and `fields` list. */
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
  { id: "results", label: "Resultado", metaField: "results" },
  {
    id: "costPerResult",
    label: "Custo por resultado",
    metaField: "cost_per_result",
  },
  { id: "purchaseRoas", label: "ROAS", metaField: "purchase_roas" },
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

/** The raw Meta Insights field name for a sort metric. */
export function getInsightsSortField(metric: CampaignSortMetric): string {
  return SORT_OPTION_BY_ID.get(metric)?.metaField ?? metric;
}

/**
 * Builds the Meta Insights `sort` token, e.g. `spend_descending` or
 * `cost_per_result_ascending`.
 * Reference: GET /act_<id>/insights?sort=["spend_descending"].
 */
export function buildInsightsSortToken(
  metric: CampaignSortMetric,
  order: SortOrder,
): string {
  const field = getInsightsSortField(metric);
  return `${field}_${order === "desc" ? "descending" : "ascending"}`;
}

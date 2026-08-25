import type { GraphApiInsights } from "./types";

/**
 * Metric fields every marketing insights read asks Graph for.
 *
 * Centralised because the CPC/CTR definition depends on it. Ads Manager's
 * "CPC (custo por clique no link)" and "CTR (taxa de cliques no link)" come from
 * `cost_per_inline_link_click` / `inline_link_click_ctr` — *not* from Graph's
 * plain `cpc` / `ctr`, which divide by **all** clicks (reactions, comments,
 * profile and "ver mais" clicks included) and therefore read materially cheaper
 * than the number the advertiser sees in Gerenciador de Anúncios. Dropping a
 * field from this list silently blanks a column in the UI.
 */
export const MARKETING_INSIGHTS_METRIC_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "inline_link_clicks",
  "reach",
  "cpc",
  "cost_per_inline_link_click",
  "cpm",
  "ctr",
  "inline_link_click_ctr",
  "cpp",
  "frequency",
  "actions",
  "cost_per_action_type",
  "cost_per_result",
  "action_values",
  "purchase_roas",
  "website_purchase_roas",
  "date_start",
  "date_stop",
] as const;

/** Comma-joined form for `fields=` and nested `insights{…}` expansions. */
export const MARKETING_INSIGHTS_FIELDS_PARAM =
  MARKETING_INSIGHTS_METRIC_FIELDS.join(",");

/**
 * CPC the way Gerenciador de Anúncios reports it: spend ÷ link clicks.
 *
 * Returns `undefined` when the object got no link clicks — Ads Manager renders
 * "—" in that case, and falling back to Graph's all-clicks `cpc` would bring
 * back exactly the divergence this resolves.
 */
export function adsManagerCpc(data: GraphApiInsights): string | undefined {
  return data.cost_per_inline_link_click;
}

/** CTR the way Gerenciador de Anúncios reports it: link clicks ÷ impressions. */
export function adsManagerCtr(data: GraphApiInsights): string | undefined {
  return data.inline_link_click_ctr;
}

/**
 * One entry of Graph's `cost_per_result` / `cost_per_objective_result`.
 *
 * Graph v24 answers `[{ indicator, values: [{ value, attribution_windows }] }]`
 * — the cost sits **nested** under `values`, not on the entry itself. Older
 * shapes carried a flat `{ action_type, value }`, so both are accepted.
 */
type CostPerResultEntry = {
  indicator?: string;
  action_type?: string;
  value?: string;
  values?: Array<{ value?: string; attribution_windows?: string[] }>;
};

function firstEntryValue(
  entries: CostPerResultEntry[] | undefined,
): string | undefined {
  if (!entries?.length) return undefined;

  for (const entry of entries) {
    if (entry.value !== undefined) return entry.value;
    const nested = entry.values?.find((v) => v.value !== undefined);
    if (nested?.value !== undefined) return nested.value;
  }

  return undefined;
}

/**
 * "Custo por resultado" as Ads Manager reports it — the cost of whatever the
 * campaign optimises for (landing page views, conversas, compras…).
 *
 * Reading only the flat `value` missed the nested v24 shape entirely, which is
 * why this metric always rendered as "-".
 */
export function costPerResultValue(
  data: GraphApiInsights,
): string | undefined {
  return (
    firstEntryValue(data.cost_per_result) ??
    firstEntryValue(data.cost_per_objective_result)
  );
}

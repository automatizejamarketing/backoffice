// Metric/operator registry for the marketing performance rules edited here.
// MIRROR of automatize-frontend/lib/marketing/performance-rules.ts — the
// frontend engine evaluates these rules; the backoffice only validates and edits
// them. Keep the keys in sync between the two files.

// Automatize-managed campaigns are identified by this name prefix. Must match
// the frontend constant (and the cron) so on-demand and scheduled refreshes
// capture the exact same campaigns.
export const AM_CAMPAIGN_PREFIX = "[AM]";

export const SUPPORTED_METRICS = {
  roas: "ROAS (retorno sobre investimento)",
  revenue: "Faturamento (valor de conversão)",
  spend: "Investimento (gasto em anúncios)",
  purchaseCount: "Número de compras",
  impressions: "Impressões",
  clicks: "Cliques",
} as const;

export const PERFORMANCE_OPERATORS = {
  gt: "maior que (>)",
  gte: "maior ou igual a (>=)",
  lt: "menor que (<)",
  lte: "menor ou igual a (<=)",
  eq: "igual a (=)",
} as const;

export type PerformanceMetricKey = keyof typeof SUPPORTED_METRICS;
export type PerformanceOperator = keyof typeof PERFORMANCE_OPERATORS;

export function isSupportedMetric(
  metric: string,
): metric is PerformanceMetricKey {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_METRICS, metric);
}

export function isSupportedOperator(
  operator: string,
): operator is PerformanceOperator {
  return Object.prototype.hasOwnProperty.call(PERFORMANCE_OPERATORS, operator);
}

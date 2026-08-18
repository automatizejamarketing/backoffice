/**
 * Versioned catalogs (objective→result, metrics whitelist, breakdowns matrix).
 * Built from the Marketing API v25.0 docs — re-confirm before shipping changes.
 */
export * from "./objectives";
export * from "./metrics";
export * from "./breakdowns";

import { OBJECTIVE_RESULTS } from "./objectives";
import { EXTRA_METRICS } from "./metrics";
import { SUPPORTED_BREAKDOWNS, BREAKDOWN_LABELS_PT } from "./breakdowns";

/**
 * Compact, static pt-BR summary of the catalogs for the agent system prompt.
 * Designed to sit in the cached system prefix (it never changes per request).
 */
export function buildCatalogSummaryPt(): string {
  const objectives = Object.entries(OBJECTIVE_RESULTS)
    .filter(([, r]) => r.kind === "action")
    .map(([obj, r]) => `- ${obj} → ${r.labelPt}`)
    .join("\n");

  const breakdowns = SUPPORTED_BREAKDOWNS.map(
    (b) => `${b} (${BREAKDOWN_LABELS_PT[b]})`,
  ).join(", ");

  const metricGroups = Array.from(
    new Set(EXTRA_METRICS.map((m) => m.group)),
  ).join(", ");

  return [
    "GLOSSÁRIO objetivo → resultado (use para extrair o resultado e o custo por resultado certos):",
    objectives,
    "OUTCOME_AWARENESS / REACH / BRAND_AWARENESS → o resultado é alcance (sem action_type).",
    "",
    `RECORTES (breakdowns) suportados: ${breakdowns}.`,
    `GRUPOS de métricas extras disponíveis: base, ${metricGroups}.`,
    "Peça métricas de vídeo apenas quando o objetivo/criativo for de vídeo.",
  ].join("\n");
}

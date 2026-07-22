import {
  PERFORMANCE_DROP_CRITICAL_RATIO,
  PERFORMANCE_DROP_MIN_PREVIOUS_PURCHASES,
  PERFORMANCE_DROP_MIN_PREVIOUS_SPEND,
  PERFORMANCE_DROP_RULE_PURCHASES,
  PERFORMANCE_DROP_RULE_ROAS,
  PERFORMANCE_DROP_WARNING_RATIO,
} from "@/lib/performance-drop/constants";

export type WindowMetrics = {
  spend: number;
  purchases: number;
  purchaseValue: number;
  /** purchaseValue / spend when spend > 0, else 0 */
  roas: number;
};

export type PerformanceDropSeverity = "warning" | "critical";

export type PerformanceDropMetric = "roas" | "purchases";

export type PerformanceDropEvaluation = {
  hasDrop: boolean;
  severity: PerformanceDropSeverity | null;
  metric: PerformanceDropMetric | null;
  ruleId: string | null;
  dropRatio: number | null;
  dropPercent: number | null;
  previous: WindowMetrics;
  current: WindowMetrics;
  sampleInsufficient: boolean;
  title: string;
  evidence: string;
  recommendation: string;
};

function dropRatio(previous: number, current: number): number | null {
  if (!(previous > 0)) return null;
  return (previous - current) / previous;
}

function severityForRatio(ratio: number): PerformanceDropSeverity | null {
  if (ratio >= PERFORMANCE_DROP_CRITICAL_RATIO) return "critical";
  if (ratio >= PERFORMANCE_DROP_WARNING_RATIO) return "warning";
  return null;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function formatRoas(value: number): string {
  return value.toFixed(2);
}

/**
 * Compare current 7d metrics vs previous 7d. Returns the worst qualifying drop
 * between ROAS and purchases (sample floors applied).
 */
export function evaluatePerformanceDrop(
  previous: WindowMetrics,
  current: WindowMetrics,
): PerformanceDropEvaluation {
  const sampleInsufficient =
    previous.spend < PERFORMANCE_DROP_MIN_PREVIOUS_SPEND;

  type Candidate = {
    metric: PerformanceDropMetric;
    ruleId: string;
    ratio: number;
    severity: PerformanceDropSeverity;
  };

  const candidates: Candidate[] = [];

  if (!sampleInsufficient && previous.roas > 0) {
    const ratio = dropRatio(previous.roas, current.roas);
    const severity = ratio == null ? null : severityForRatio(ratio);
    if (ratio != null && severity) {
      candidates.push({
        metric: "roas",
        ruleId: PERFORMANCE_DROP_RULE_ROAS,
        ratio,
        severity,
      });
    }
  }

  if (
    !sampleInsufficient &&
    previous.purchases >= PERFORMANCE_DROP_MIN_PREVIOUS_PURCHASES
  ) {
    const ratio = dropRatio(previous.purchases, current.purchases);
    const severity = ratio == null ? null : severityForRatio(ratio);
    if (ratio != null && severity) {
      candidates.push({
        metric: "purchases",
        ruleId: PERFORMANCE_DROP_RULE_PURCHASES,
        ratio,
        severity,
      });
    }
  }

  candidates.sort((a, b) => b.ratio - a.ratio);
  const winner = candidates[0];

  if (!winner) {
    return {
      hasDrop: false,
      severity: null,
      metric: null,
      ruleId: null,
      dropRatio: null,
      dropPercent: null,
      previous,
      current,
      sampleInsufficient,
      title: sampleInsufficient
        ? "Amostra insuficiente para medir queda"
        : "Sem queda relevante nos últimos 7 dias",
      evidence: sampleInsufficient
        ? `Gasto na janela anterior (R$ ${previous.spend.toFixed(2)}) abaixo do mínimo (${PERFORMANCE_DROP_MIN_PREVIOUS_SPEND}).`
        : `ROAS ${formatRoas(previous.roas)} → ${formatRoas(current.roas)}; compras ${previous.purchases} → ${current.purchases}.`,
      recommendation: sampleInsufficient
        ? "Aguardar mais volume de mídia antes de interpretar queda."
        : "Manter monitoramento; nenhuma ação urgente por queda WoW.",
    };
  }

  const dropPercent = Math.round(winner.ratio * 100);
  const metricLabel = winner.metric === "roas" ? "ROAS" : "compras";
  const prevValue =
    winner.metric === "roas"
      ? formatRoas(previous.roas)
      : String(previous.purchases);
  const currValue =
    winner.metric === "roas"
      ? formatRoas(current.roas)
      : String(current.purchases);

  return {
    hasDrop: true,
    severity: winner.severity,
    metric: winner.metric,
    ruleId: winner.ruleId,
    dropRatio: winner.ratio,
    dropPercent,
    previous,
    current,
    sampleInsufficient: false,
    title:
      winner.severity === "critical"
        ? `Queda crítica de ${metricLabel} (−${formatPercent(winner.ratio)})`
        : `Queda de ${metricLabel} (−${formatPercent(winner.ratio)})`,
    evidence: `${metricLabel} caiu de ${prevValue} para ${currValue} vs. os 7 dias anteriores (gasto ant. ${previous.spend.toFixed(2)}, atual ${current.spend.toFixed(2)}).`,
    recommendation:
      winner.severity === "critical"
        ? "Revisar campanhas [AM], criativos e eventos de conversão com prioridade."
        : "Investigar causa da queda e ajustar orçamento/criativo se persistir.",
  };
}

export function emptyWindowMetrics(): WindowMetrics {
  return { spend: 0, purchases: 0, purchaseValue: 0, roas: 0 };
}

export function aggregateWindowMetrics(
  parts: Array<Pick<WindowMetrics, "spend" | "purchases" | "purchaseValue">>,
): WindowMetrics {
  let spend = 0;
  let purchases = 0;
  let purchaseValue = 0;
  for (const part of parts) {
    spend += part.spend;
    purchases += part.purchases;
    purchaseValue += part.purchaseValue;
  }
  return {
    spend,
    purchases,
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : 0,
  };
}

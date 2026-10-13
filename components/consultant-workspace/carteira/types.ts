/**
 * O que o servidor manda para a Fila/Mesa (enxuto) e como volta a ser
 * WorkspaceClient/WorkspaceAlert no navegador. Puro, sem React.
 *
 * A carteira inteira vai numa resposta só; para caber leve, a série diária vira
 * dois vetores, o KPI é recalculado aqui (mesma regra do servidor) e os alertas
 * viajam como tuplas com dicionário de regras e recomendações (são ~15 textos
 * repetidos centenas de vezes).
 */
import type { JourneyExtras } from "@/lib/consultant-workspace/journey";
import { primaryKpi } from "@/lib/consultant-workspace/metrics";
import type {
  DailyPoint,
  PrimaryKpi,
  WorkspaceAlert,
  WorkspaceClient,
  WorkspaceRange,
  WorkspaceState,
} from "@/lib/consultant-workspace/types";

export type WireClient = Omit<WorkspaceClient, "perf" | "alerts"> & {
  perf: Omit<WorkspaceClient["perf"], "series" | "kpi" | "previousKpi"> & {
    kpiKind: PrimaryKpi["kind"];
    spendByDay: number[];
    resultsByDay: number[];
  };
};

const SEVERITIES = ["critical", "warning", "info"] as const;

/** [id, userId, regra, gravidade, evidência, recomendação, nível, nome da entidade, criado em] */
export type WireAlertRow = [
  string,
  string,
  number,
  0 | 1 | 2,
  string,
  number,
  string,
  string | null,
  string,
];

export type WireAlerts = {
  rules: Array<[ruleId: string, ruleTitle: string]>;
  recommendations: string[];
  rows: WireAlertRow[];
};

export type CarteiraData = {
  range: WorkspaceRange;
  clients: WireClient[];
  alerts: WireAlerts;
  extras: Record<string, JourneyExtras>;
  /** Alertas já tratados que não estão mais abertos: id → cliente (para "você tratou hoje"). */
  touchedAlertUser: Record<string, string>;
  store: WorkspaceState;
};

export function encodeAlerts(alerts: WorkspaceAlert[], clip: (text: string, max: number) => string): WireAlerts {
  const ruleIndex = new Map<string, number>();
  const rules: WireAlerts["rules"] = [];
  const recIndex = new Map<string, number>();
  const recommendations: string[] = [];
  const rows = alerts.map<WireAlertRow>((alert) => {
    let rule = ruleIndex.get(alert.ruleId);
    if (rule == null) {
      rule = rules.length;
      rules.push([alert.ruleId, alert.ruleTitle]);
      ruleIndex.set(alert.ruleId, rule);
    }
    const recText = clip(alert.recommendation, 260);
    let rec = recText ? recIndex.get(recText) : -1;
    if (rec == null) {
      rec = recommendations.length;
      recommendations.push(recText);
      recIndex.set(recText, rec);
    }
    return [
      alert.id,
      alert.userId,
      rule,
      SEVERITIES.indexOf(alert.severity) as 0 | 1 | 2,
      clip(alert.evidence, 360),
      rec,
      alert.entityLevel,
      alert.entityName,
      alert.createdAt,
    ];
  });
  return { rules, recommendations, rows };
}

export function decodeAlerts(wire: WireAlerts): WorkspaceAlert[] {
  return wire.rows.map(([id, userId, rule, severity, evidence, rec, entityLevel, entityName, createdAt]) => {
    const [ruleId, ruleTitle] = wire.rules[rule];
    return {
      id,
      userId,
      ruleId,
      ruleTitle,
      family: ruleId.startsWith("account.") ? "account" : "playbook",
      severity: SEVERITIES[severity],
      title: ruleTitle,
      evidence,
      recommendation: rec >= 0 ? wire.recommendations[rec] : "",
      entityLevel,
      entityId: "",
      entityName,
      actionType: "",
      metrics: {},
      createdAt,
    };
  });
}

export function hydrateClient(client: WireClient, range: WorkspaceRange): WorkspaceClient {
  const { spendByDay, resultsByDay, kpiKind, ...perf } = client.perf;
  const series: DailyPoint[] = [];
  const cursor = new Date(`${range.from}T12:00:00Z`);
  for (let index = 0; index < spendByDay.length; index += 1) {
    series.push({
      date: cursor.toISOString().slice(0, 10),
      spend: spendByDay[index] ?? 0,
      results: resultsByDay[index] ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return {
    ...client,
    perf: {
      ...perf,
      kpi: primaryKpi(perf.current, kpiKind),
      previousKpi: primaryKpi(perf.previous, kpiKind),
      series,
    },
    alerts: { open: 0, critical: 0, warning: 0, info: 0, oldestOpenAt: null },
  };
}

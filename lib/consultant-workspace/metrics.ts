/**
 * Regras de métrica da área de Tráfego — puras, usadas no servidor e no cliente.
 */
import type {
  GoalKpi,
  PerfTotals,
  PlanTier,
  PrimaryKpi,
  WorkspaceClient,
  WorkspaceGoal,
  WorkspaceRange,
} from "./types";

export function emptyTotals(): PerfTotals {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    linkClicks: 0,
    results: 0,
    purchases: 0,
    purchaseValue: 0,
    leads: 0,
    conversations: 0,
  };
}

/** Período fechado: termina ontem (hoje ainda está incompleto na Meta). */
export function workspaceRange(days: number, today = new Date()): WorkspaceRange {
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);
  const base = new Date(`${fmt(today)}T12:00:00Z`);
  const shift = (offset: number) => {
    const value = new Date(base);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  return {
    to: shift(-1),
    from: shift(-days),
    prevTo: shift(-days - 1),
    prevFrom: shift(-days * 2),
    days,
  };
}

/** Escolhe o resultado que importa para a conta: compra > lead > conversa > resultado da Meta. */
export function primaryKpi(
  totals: PerfTotals,
  forcedKind?: PrimaryKpi["kind"],
): PrimaryKpi {
  const kind =
    forcedKind ??
    (totals.purchases > 0 || totals.purchaseValue > 0
      ? "compras"
      : totals.leads > 0
        ? "leads"
        : totals.conversations > 0
          ? "conversas"
          : "resultados");
  const count =
    kind === "compras"
      ? totals.purchases
      : kind === "leads"
        ? totals.leads
        : kind === "conversas"
          ? totals.conversations
          : totals.results;
  const labels = {
    compras: ["Compras", "CPA"],
    leads: ["Leads", "CPL"],
    conversas: ["Conversas", "Custo/conversa"],
    resultados: ["Resultados", "Custo/resultado"],
  } as const;
  return {
    kind,
    label: labels[kind][0],
    costLabel: labels[kind][1],
    count,
    cost: count > 0 ? totals.spend / count : null,
    roas: kind === "compras" && totals.spend > 0 ? totals.purchaseValue / totals.spend : null,
  };
}

export function goalKpiForKind(kind: PrimaryKpi["kind"]): GoalKpi {
  return kind === "compras"
    ? "cpa"
    : kind === "leads"
      ? "cpl"
      : kind === "conversas"
        ? "custo_conversa"
        : "custo_resultado";
}

export const GOAL_KPI_LABEL: Record<GoalKpi, string> = {
  cpa: "CPA máximo",
  cpl: "CPL máximo",
  custo_conversa: "Custo por conversa máximo",
  roas: "ROAS mínimo",
  custo_resultado: "Custo por resultado máximo",
};

export type GoalStatus = "sem_meta" | "sem_dados" | "na_meta" | "perto" | "fora";

/** Compara o período com a meta: até 10% pior que o alvo conta como "perto". */
export function goalStatus(kpi: PrimaryKpi, goal: WorkspaceGoal | undefined): {
  status: GoalStatus;
  actual: number | null;
  ratio: number | null;
} {
  if (!goal) return { status: "sem_meta", actual: null, ratio: null };
  const actual = goal.kpi === "roas" ? kpi.roas : kpi.cost;
  if (actual == null || goal.target <= 0) return { status: "sem_dados", actual, ratio: null };
  // ratio > 1 = pior que a meta.
  const ratio = goal.kpi === "roas" ? goal.target / Math.max(actual, 0.0001) : actual / goal.target;
  const status = ratio <= 1 ? "na_meta" : ratio <= 1.1 ? "perto" : "fora";
  return { status, actual, ratio };
}

/** Ritmo da verba no mês: gasto até ontem contra o proporcional da verba combinada. */
export function budgetPacing(
  monthToDateSpend: number,
  monthlyBudget: number | null | undefined,
  range: WorkspaceRange,
): { expected: number; ratio: number; projected: number } | null {
  if (!monthlyBudget || monthlyBudget <= 0) return null;
  const [year, month, day] = range.to.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const expected = (monthlyBudget * day) / daysInMonth;
  return {
    expected,
    ratio: expected > 0 ? monthToDateSpend / expected : 0,
    projected: (monthToDateSpend / day) * daysInMonth,
  };
}

/** Variação relativa; null quando não há base. */
export function delta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

export const PLAN_RANK: Record<PlanTier, number> = {
  premium: 0,
  pro: 1,
  starter: 2,
  sem_plano: 3,
};

export const PLAN_LABEL: Record<PlanTier, string> = {
  premium: "Premium",
  pro: "Pro",
  starter: "Starter",
  sem_plano: "Sem plano",
};

/** O que cada plano promete na landing — o nível de serviço do consultor. */
export const PLAN_SERVICE: Record<PlanTier, string> = {
  premium: "Gerente de contas dedicado + reunião mensal",
  pro: "Setup da 1ª campanha + suporte via WhatsApp",
  starter: "Tráfego automático + suporte por e-mail",
  sem_plano: "Acesso manual, sem assinatura",
};

export const META_HEALTH_LABEL: Record<WorkspaceClient["meta"]["health"], string> = {
  ok: "Meta ok",
  token_invalido: "Precisa reconectar",
  erro_checagem: "Erro ao ler a conta",
  checagem_velha: "Leitura atrasada",
  sem_meta: "Sem Meta",
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const int = new Intl.NumberFormat("pt-BR");

export function formatMoney(value: number | null | undefined, decimals = true) {
  if (value == null || Number.isNaN(value)) return "—";
  return (decimals ? brl : brl0).format(value);
}

export function formatInt(value: number | null | undefined) {
  if (value == null) return "—";
  return int.format(Math.round(value));
}

export function formatRoas(value: number | null | undefined) {
  if (value == null) return "—";
  return `${value.toFixed(2).replace(".", ",")}x`;
}

export function formatPct(value: number | null | undefined, signed = true) {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = Math.round(value * 100);
  return `${signed && pct > 0 ? "+" : ""}${pct}%`;
}

export function formatRelative(isoDate: string | null | undefined, now = Date.now()) {
  if (!isoDate) return "nunca";
  const diff = now - new Date(isoDate).getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `há ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ontem" : `há ${days} dias`;
}

export function formatDay(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}${year ? "" : ""}`;
}

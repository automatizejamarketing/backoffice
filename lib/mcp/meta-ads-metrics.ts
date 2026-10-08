import { round2 } from "@/lib/meta-business/insights/currency";
import { playbookBusinessDateKey, previousInclusiveRange, shiftYmd } from "@/lib/playbook-insights/dates";

/** Read-only Meta Ads math for the consultant MCP: periods, totals, variation, ranking. Pure. */

export type Period = { since: string; until: string };
export type ComparedPeriods = { current: Period; previous: Period; days: number; includesToday: boolean };

export const MAX_PERIOD_DAYS = 90;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function dayCount(p: Period): number {
  return Math.round((Date.parse(`${p.until}T12:00:00Z`) - Date.parse(`${p.since}T12:00:00Z`)) / 86_400_000) + 1;
}

/**
 * The period asked for and the one right before it, same length. Default: the last `days`
 * complete days (ending yesterday, Brasília), because today's numbers are still moving.
 */
export function resolvePeriods(input: { days?: number; since?: string; until?: string }, now = new Date()): ComparedPeriods {
  const today = playbookBusinessDateKey(now);
  let current: Period;
  if (input.since || input.until) {
    if (!input.since || !input.until) throw new Error("Informe since e until juntos (AAAA-MM-DD), ou use days.");
    if (!YMD.test(input.since) || !YMD.test(input.until) || Number.isNaN(Date.parse(input.since)) || Number.isNaN(Date.parse(input.until)))
      throw new Error("Datas no formato AAAA-MM-DD.");
    if (input.since > input.until) throw new Error("since deve ser antes de until.");
    if (input.until > today) throw new Error(`until não pode ser depois de hoje (${today}).`);
    current = { since: input.since, until: input.until };
  } else {
    const days = Math.trunc(input.days ?? 7);
    if (days < 1 || days > MAX_PERIOD_DAYS) throw new Error(`days entre 1 e ${MAX_PERIOD_DAYS}.`);
    const until = shiftYmd(today, -1);
    current = { since: shiftYmd(until, -(days - 1)), until };
  }
  const days = dayCount(current);
  if (days > MAX_PERIOD_DAYS) throw new Error(`Período máximo de ${MAX_PERIOD_DAYS} dias.`);
  return { current, previous: previousInclusiveRange(current), days, includesToday: current.until === today };
}

/** Percent change, one decimal. null when there is no base to compare against. */
export function pctChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Summed facts of one window (account currency, major units). */
export type WindowTotals = {
  spend: number;
  /** Each campaign's own result as Meta defines it (conversations, purchases, leads…), summed. */
  results: number;
  purchases: number;
  revenue: number;
  leads: number;
  conversations: number;
  impressions: number;
  linkClicks: number;
  campaignsWithSpend: number;
};

export const EMPTY_WINDOW: WindowTotals = {
  spend: 0, results: 0, purchases: 0, revenue: 0, leads: 0, conversations: 0, impressions: 0, linkClicks: 0, campaignsWithSpend: 0,
};

const ratio = (num: number, den: number) => (den > 0 ? round2(num / den) : null);

/**
 * `sells`: the client had purchase value in either window. Then a window without revenue is a
 * real ROAS of 0 (a -100% drop), not "no ROAS" — only clients that never sell get null.
 */
export function windowKpis(t: WindowTotals, sells = t.revenue > 0) {
  return {
    costPerResult: ratio(t.spend, t.results),
    costPerPurchase: ratio(t.spend, t.purchases),
    roas: sells ? ratio(t.revenue, t.spend) : null,
    ctr: t.impressions > 0 ? round2((t.linkClicks / t.impressions) * 100) : null,
  };
}

/** One client's line: current window, previous window and the variation between them. */
export function compareWindows(current: WindowTotals, previous: WindowTotals) {
  const sells = current.revenue > 0 || previous.revenue > 0;
  const cur = windowKpis(current, sells);
  const prev = windowKpis(previous, sells);
  return {
    spend: round2(current.spend) ?? 0,
    results: current.results,
    costPerResult: cur.costPerResult,
    purchases: current.purchases,
    costPerPurchase: cur.costPerPurchase,
    revenue: round2(current.revenue) ?? 0,
    roas: cur.roas,
    leads: current.leads,
    conversations: current.conversations,
    linkCtr: cur.ctr,
    campaignsWithSpend: current.campaignsWithSpend,
    previous: { spend: round2(previous.spend) ?? 0, results: previous.results, costPerResult: prev.costPerResult, roas: prev.roas },
    change: {
      spend: pctChange(current.spend, previous.spend),
      results: pctChange(current.results, previous.results),
      costPerResult: pctChange(cur.costPerResult, prev.costPerResult),
      roas: pctChange(cur.roas, prev.roas),
    },
  };
}

export type ClientComparison = ReturnType<typeof compareWindows>;

export function sumWindows(rows: readonly WindowTotals[]): WindowTotals {
  const total = { ...EMPTY_WINDOW };
  for (const row of rows) for (const key of Object.keys(total) as (keyof WindowTotals)[]) total[key] += row[key];
  return total;
}

export const PORTFOLIO_SORTS = ["spend", "spend_change", "results", "results_change", "cost_per_result", "cost_per_result_change", "roas", "roas_change"] as const;
export type PortfolioSort = (typeof PORTFOLIO_SORTS)[number];

const SORT_VALUE: Record<PortfolioSort, (c: ClientComparison) => number | null> = {
  spend: c => c.spend,
  spend_change: c => c.change.spend,
  results: c => c.results,
  results_change: c => c.change.results,
  cost_per_result: c => c.costPerResult,
  cost_per_result_change: c => c.change.costPerResult,
  roas: c => c.roas,
  roas_change: c => c.change.roas,
};

/** Sort by the chosen metric; rows without that metric always go last, by spend. */
export function sortComparisons<T extends { metrics: ClientComparison }>(rows: readonly T[], sortBy: PortfolioSort, order: "asc" | "desc"): T[] {
  const dir = order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = SORT_VALUE[sortBy](a.metrics);
    const vb = SORT_VALUE[sortBy](b.metrics);
    if (va == null || vb == null) {
      if (va != null) return -1;
      if (vb != null) return 1;
      return b.metrics.spend - a.metrics.spend;
    }
    return (va - vb) * dir || b.metrics.spend - a.metrics.spend;
  });
}

/** Trim long free text (alert evidence) so a whole portfolio fits in one answer. */
export function clip(text: string | null | undefined, max = 400): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

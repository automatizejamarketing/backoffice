import type {
  DashboardDateSearchParams,
  DashboardDateWindow,
} from "./dashboard-date-range";
import {
  type CancellationStatsFilters,
} from "./cancellation-stats";
import {
  VALID_CANCELLATION_STATS_PLANS,
  VALID_CANCELLATION_STATS_PROVIDERS,
} from "./cancellation-stats-constants";

export const DASHBOARD_TAB_VALUES = ["visao", "retencao", "trials", "produtos"] as const;
export type DashboardTab = (typeof DASHBOARD_TAB_VALUES)[number];

export type DashboardSearchParams = DashboardDateSearchParams & {
  tab?: string | string[];
  conversion?: string | string[];
  provider?: string | string[];
  plan?: string | string[];
};

export type ConversionView = "historical" | "period";

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveDashboardTab(params: DashboardSearchParams): DashboardTab {
  const tab = firstValue(params.tab);
  return DASHBOARD_TAB_VALUES.includes(tab as DashboardTab)
    ? (tab as DashboardTab)
    : "visao";
}

export function resolveConversionView(
  params: DashboardSearchParams,
): ConversionView {
  return firstValue(params.conversion) === "period" ? "period" : "historical";
}

export function resolveCancellationStatsFilters(
  params: DashboardSearchParams,
): CancellationStatsFilters {
  const provider = firstValue(params.provider);
  const planType = firstValue(params.plan);
  return {
    provider: VALID_CANCELLATION_STATS_PROVIDERS.includes(
      provider as (typeof VALID_CANCELLATION_STATS_PROVIDERS)[number],
    )
      ? (provider as CancellationStatsFilters["provider"])
      : undefined,
    planType: VALID_CANCELLATION_STATS_PLANS.includes(
      planType as (typeof VALID_CANCELLATION_STATS_PLANS)[number],
    )
      ? (planType as CancellationStatsFilters["planType"])
      : undefined,
  };
}

export function buildDashboardHref(
  tab: DashboardTab,
  window: DashboardDateWindow,
  filters: CancellationStatsFilters = {},
) {
  const params = new URLSearchParams({
    range: window.preset,
    from: window.fromDate,
    to: window.throughDate,
  });
  if (filters.provider) params.set("provider", filters.provider);
  if (filters.planType) params.set("plan", filters.planType);
  if (tab !== "visao") params.set("tab", tab);
  return `/?${params.toString()}`;
}

import type {
  DashboardDateSearchParams,
  DashboardDateWindow,
} from "./dashboard-date-range";

export const DASHBOARD_TAB_VALUES = ["visao", "retencao", "trials"] as const;
export type DashboardTab = (typeof DASHBOARD_TAB_VALUES)[number];

export type DashboardSearchParams = DashboardDateSearchParams & {
  tab?: string | string[];
  conversion?: string | string[];
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

export function buildDashboardHref(
  tab: DashboardTab,
  window: DashboardDateWindow,
) {
  const params = new URLSearchParams({
    range: window.preset,
    from: window.fromDate,
    to: window.throughDate,
  });
  if (tab !== "visao") params.set("tab", tab);
  return `/?${params.toString()}`;
}

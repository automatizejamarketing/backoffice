import type { DashboardDateSearchParams } from "./dashboard-date-range";

export const FINANCE_TAB_VALUES = ["visao", "pagamentos"] as const;
export type FinanceTab = (typeof FINANCE_TAB_VALUES)[number];

export const FINANCE_PAYMENT_SOURCE_VALUES = ["automatize", "produtos"] as const;
export type FinancePaymentSource =
  (typeof FINANCE_PAYMENT_SOURCE_VALUES)[number];

export type FinanceSearchParams = DashboardDateSearchParams & {
  tab?: string | string[];
  source?: string | string[];
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function isFinanceTab(value: string | undefined): value is FinanceTab {
  return Boolean(
    value && (FINANCE_TAB_VALUES as readonly string[]).includes(value),
  );
}

export function isFinancePaymentSource(
  value: string | undefined,
): value is FinancePaymentSource {
  return Boolean(
    value &&
      (FINANCE_PAYMENT_SOURCE_VALUES as readonly string[]).includes(value),
  );
}

export function resolveFinanceTab(params: FinanceSearchParams): FinanceTab {
  const tab = firstValue(params.tab);
  return isFinanceTab(tab) ? tab : "visao";
}

export function resolveFinancePaymentSource(
  params: FinanceSearchParams,
): FinancePaymentSource {
  const source = firstValue(params.source);
  return isFinancePaymentSource(source) ? source : "automatize";
}

export function buildFinanceHref({
  tab = "visao",
  source = "automatize",
  range,
  from,
  to,
}: {
  tab?: FinanceTab;
  source?: FinancePaymentSource;
  range?: string;
  from?: string;
  to?: string;
}) {
  const params = new URLSearchParams();
  if (tab !== "visao") {
    params.set("tab", tab);
  }
  if (tab === "pagamentos" && source !== "automatize") {
    params.set("source", source);
  }
  if (range) params.set("range", range);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return query ? `/finance?${query}` : "/finance";
}

export function buildFinanceDateHref(
  base: {
    tab: FinanceTab;
    source: FinancePaymentSource;
    preset: string;
    fromDate: string;
    throughDate: string;
  },
  nextFrom: string,
  nextTo: string,
) {
  return buildFinanceHref({
    tab: base.tab,
    source: base.source,
    range: "custom",
    from: nextFrom,
    to: nextTo,
  });
}

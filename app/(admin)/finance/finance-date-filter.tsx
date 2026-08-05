"use client";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  buildFinanceDateHref,
  type FinancePaymentSource,
  type FinanceTab,
} from "@/lib/backoffice/finance-search-params";
import type { DashboardDateWindow } from "@/lib/backoffice/dashboard-date-range";
import { useDashboardNavigation } from "../dashboard-navigation-feedback";

function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatCalendarDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type FinanceDateFilterProps = {
  window: DashboardDateWindow;
  tab: FinanceTab;
  source: FinancePaymentSource;
};

export function FinanceDateFilter({
  window,
  tab,
  source,
}: FinanceDateFilterProps) {
  const { navigate } = useDashboardNavigation();

  return (
    <nav aria-label="Período dos dados" className="w-full sm:w-auto">
      <DateRangePicker
        date={{
          from: parseCalendarDate(window.fromDate),
          to: parseCalendarDate(window.throughDate),
        }}
        disabledAfter={new Date()}
        placeholder="Selecionar período"
        className="h-9 w-full px-3 text-xs shadow-none sm:w-[220px]"
        onDateChange={({ from, to }) => {
          if (!from || !to) return;
          navigate(
            buildFinanceDateHref(
              {
                tab,
                source,
                preset: window.preset,
                fromDate: window.fromDate,
                throughDate: window.throughDate,
              },
              formatCalendarDate(from),
              formatCalendarDate(to),
            ),
          );
        }}
      />
    </nav>
  );
}

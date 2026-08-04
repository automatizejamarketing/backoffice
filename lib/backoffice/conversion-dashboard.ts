import {
  shiftCalendarDate,
  type DashboardDateWindow,
} from "./dashboard-date-range";

export type DailyConversionCohort = {
  date: string;
  newUsers: number;
  activated: number;
  paid: number;
  onboardingCompleted: number;
};

export type ConversionWindow = DashboardDateWindow;

export type ConversionSummary = Omit<DailyConversionCohort, "date"> & {
  activationRate: number;
  paidRate: number;
  onboardingRate: number;
};

export function fillDailyConversionCohorts(
  rows: DailyConversionCohort[],
  window: Pick<ConversionWindow, "fromDate" | "throughDate">,
): DailyConversionCohort[] {
  const rowsByDate = new Map(rows.map((row) => [row.date, row]));
  const result: DailyConversionCohort[] = [];

  for (
    let date = window.fromDate;
    date <= window.throughDate;
    date = shiftCalendarDate(date, 1)
  ) {
    result.push(
      rowsByDate.get(date) ?? {
        date,
        newUsers: 0,
        activated: 0,
        paid: 0,
        onboardingCompleted: 0,
      },
    );
  }

  return result;
}

function percentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

export function summarizeConversionCohorts(
  rows: DailyConversionCohort[],
): ConversionSummary {
  const totals = rows.reduce(
    (acc, row) => ({
      newUsers: acc.newUsers + row.newUsers,
      activated: acc.activated + row.activated,
      paid: acc.paid + row.paid,
      onboardingCompleted:
        acc.onboardingCompleted + row.onboardingCompleted,
    }),
    { newUsers: 0, activated: 0, paid: 0, onboardingCompleted: 0 },
  );

  return {
    ...totals,
    activationRate: percentage(totals.activated, totals.newUsers),
    paidRate: percentage(totals.paid, totals.newUsers),
    onboardingRate: percentage(
      totals.onboardingCompleted,
      totals.newUsers,
    ),
  };
}

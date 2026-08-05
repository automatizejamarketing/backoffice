import {
  shiftCalendarDate,
  type DashboardDateWindow,
} from "./dashboard-date-range";

export type DailyConversionCohort = {
  date: string;
  newUsers: number;
  onboardingCompleted: number;
  metaConnected: number;
  paid: number;
};

export type ConversionWindow = DashboardDateWindow;

export type ConversionSummary = Omit<DailyConversionCohort, "date"> & {
  onboardingRate: number;
  metaConnectionRate: number;
  paidRate: number;
};

export type CohortOutcomeSummary = {
  trial: number;
  churn: number;
  trialRate: number;
  churnRate: number;
};

export function summarizeCohortOutcomes(
  trial: number,
  churn: number,
  newUsers: number,
): CohortOutcomeSummary {
  return {
    trial,
    churn,
    trialRate: percentage(trial, newUsers),
    churnRate: percentage(churn, newUsers),
  };
}

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
        onboardingCompleted: 0,
        metaConnected: 0,
        paid: 0,
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
      onboardingCompleted:
        acc.onboardingCompleted + row.onboardingCompleted,
      metaConnected: acc.metaConnected + row.metaConnected,
      paid: acc.paid + row.paid,
    }),
    { newUsers: 0, onboardingCompleted: 0, metaConnected: 0, paid: 0 },
  );

  return {
    ...totals,
    onboardingRate: percentage(
      totals.onboardingCompleted,
      totals.newUsers,
    ),
    metaConnectionRate: percentage(totals.metaConnected, totals.newUsers),
    paidRate: percentage(totals.paid, totals.newUsers),
  };
}

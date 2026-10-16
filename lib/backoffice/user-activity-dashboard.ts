import type { PaidAccessPeriod } from "./paid-access-periods";
import {
  brtStartOfCalendarDate,
  formatBrtCalendarDate,
  shiftCalendarDate,
  type DashboardDateWindow,
} from "./dashboard-date-range";

export const USER_ACTIVITY_SERIES_KEYS = [
  "newUsers",
  "users",
  "activeUsers",
  "churn",
] as const;

export type UserActivitySeriesKey = (typeof USER_ACTIVITY_SERIES_KEYS)[number];

export const USER_ACTIVITY_DAY_SERIES_KEYS = [
  ...USER_ACTIVITY_SERIES_KEYS,
  "trials",
  "payments",
] as const;

export type UserActivityDaySeriesKey =
  (typeof USER_ACTIVITY_DAY_SERIES_KEYS)[number];

export type DailyUserActivity = {
  date: string;
  newUsers: number;
  /** Trials that started on the day (first trial_grant). */
  trials: number;
  /** First approved subscription payments made on the day. */
  payments: number;
  totalUsers: number;
  activeUsers: number;
  /** Paying customers on the previous day whose access ended on this day. */
  churn: number;
  /** Saldo: paying customers today minus paying customers the day before. */
  activeUsersChange: number;
};

export type UserActivityCounts = {
  date: string;
  count: number;
};

export type UserActivitySummary = {
  newUsers: number;
  trials: number;
  payments: number;
  totalUsers: number;
  activeUsers: number;
  churn: number;
  /** Paying customers at the end of the window minus the day before it. */
  activeUsersChange: number;
};

/** A customer's paid access periods, oldest first. */
export type PaidAccessCustomer = {
  periods: PaidAccessPeriod[];
};

export function isUserActivitySeriesKey(
  value: string | null | undefined,
): value is UserActivitySeriesKey {
  return USER_ACTIVITY_SERIES_KEYS.includes(value as UserActivitySeriesKey);
}

export function isUserActivityDaySeriesKey(
  value: string | null | undefined,
): value is UserActivityDaySeriesKey {
  return USER_ACTIVITY_DAY_SERIES_KEYS.includes(
    value as UserActivityDaySeriesKey,
  );
}

export function isUserActivityCalendarDate(
  value: string | null | undefined,
): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function fillDailyUserActivity(
  input: {
    newUsers: UserActivityCounts[];
    trials?: UserActivityCounts[];
    payments?: UserActivityCounts[];
    activeUsers: UserActivityCounts[];
    churn?: UserActivityCounts[];
    usersBeforeWindow: number;
    /** Paying customers on the day before the window, base of the first saldo. */
    activeUsersBeforeWindow?: number;
  },
  window: Pick<DashboardDateWindow, "fromDate" | "throughDate">,
): DailyUserActivity[] {
  const newUsersByDate = new Map(
    input.newUsers.map((row) => [row.date, row.count]),
  );
  const trialsByDate = new Map(
    (input.trials ?? []).map((row) => [row.date, row.count]),
  );
  const paymentsByDate = new Map(
    (input.payments ?? []).map((row) => [row.date, row.count]),
  );
  const activeUsersByDate = new Map(
    input.activeUsers.map((row) => [row.date, row.count]),
  );
  const churnByDate = new Map(
    (input.churn ?? []).map((row) => [row.date, row.count]),
  );
  const result: DailyUserActivity[] = [];
  let totalUsers = input.usersBeforeWindow;
  let previousActiveUsers = input.activeUsersBeforeWindow;

  for (
    let date = window.fromDate;
    date <= window.throughDate;
    date = shiftCalendarDate(date, 1)
  ) {
    const newUsers = newUsersByDate.get(date) ?? 0;
    const activeUsers = activeUsersByDate.get(date) ?? 0;
    totalUsers += newUsers;
    result.push({
      date,
      newUsers,
      trials: trialsByDate.get(date) ?? 0,
      payments: paymentsByDate.get(date) ?? 0,
      totalUsers,
      activeUsers,
      churn: churnByDate.get(date) ?? 0,
      activeUsersChange: activeUsers - (previousActiveUsers ?? activeUsers),
    });
    previousActiveUsers = activeUsers;
  }

  return result;
}

export function summarizeUserActivity(
  daily: DailyUserActivity[],
): UserActivitySummary {
  const last = daily.at(-1);

  return {
    newUsers: daily.reduce((sum, row) => sum + row.newUsers, 0),
    trials: daily.reduce((sum, row) => sum + row.trials, 0),
    payments: daily.reduce((sum, row) => sum + row.payments, 0),
    totalUsers: last?.totalUsers ?? 0,
    activeUsers: last?.activeUsers ?? 0,
    churn: daily.reduce((sum, row) => sum + row.churn, 0),
    activeUsersChange: daily.reduce(
      (sum, row) => sum + row.activeUsersChange,
      0,
    ),
  };
}

/**
 * Same instant the "pagantes" card uses: now on the current BRT day,
 * otherwise the start of the next BRT day (end of that completed day).
 */
export function activePayingReferenceTime(date: string, now: Date): Date {
  const today = formatBrtCalendarDate(now);
  if (date >= today) return now;
  return brtStartOfCalendarDate(shiftCalendarDate(date, 1));
}

function periodCoversDate(
  period: PaidAccessPeriod,
  date: string,
  now: Date,
): boolean {
  return (
    formatBrtCalendarDate(period.startedAt) <= date &&
    period.endedAt.getTime() > activePayingReferenceTime(date, now).getTime()
  );
}

/** Paid access had started and was still ahead of the day's reference instant. */
export function isActivePayingOnDate(
  customer: PaidAccessCustomer,
  date: string,
  now: Date,
): boolean {
  return customer.periods.some((period) => periodCoversDate(period, date, now));
}

/**
 * Churn on a BRT day: paying on the previous day, not paying on this one, so
 * the pagantes line drops by exactly this count. It stays on that day even if
 * the customer comes back later; a return within the grace is not a period
 * break, so it is never churn.
 */
export function isChurnedOnDate(
  customer: PaidAccessCustomer,
  date: string,
  now: Date,
): boolean {
  return (
    isActivePayingOnDate(customer, shiftCalendarDate(date, -1), now) &&
    !isActivePayingOnDate(customer, date, now)
  );
}

function countCustomersPerDay(
  customers: PaidAccessCustomer[],
  window: Pick<DashboardDateWindow, "fromDate" | "throughDate">,
  now: Date,
  matches: (customer: PaidAccessCustomer, date: string, now: Date) => boolean,
): UserActivityCounts[] {
  const result: UserActivityCounts[] = [];

  for (
    let date = window.fromDate;
    date <= window.throughDate;
    date = shiftCalendarDate(date, 1)
  ) {
    let count = 0;
    for (const customer of customers) {
      if (matches(customer, date, now)) count += 1;
    }
    result.push({ date, count });
  }

  return result;
}

/** Paying customers on each BRT day, at the same instant the base card uses. */
export function buildActiveUserStock(
  customers: PaidAccessCustomer[],
  window: Pick<DashboardDateWindow, "fromDate" | "throughDate">,
  now: Date = new Date(),
): UserActivityCounts[] {
  return countCustomersPerDay(customers, window, now, isActivePayingOnDate);
}

export function buildChurnCounts(
  customers: PaidAccessCustomer[],
  window: Pick<DashboardDateWindow, "fromDate" | "throughDate">,
  now: Date = new Date(),
): UserActivityCounts[] {
  return countCustomersPerDay(customers, window, now, isChurnedOnDate);
}

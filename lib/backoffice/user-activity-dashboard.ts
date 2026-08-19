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
] as const;

export type UserActivitySeriesKey = (typeof USER_ACTIVITY_SERIES_KEYS)[number];

export type DailyUserActivity = {
  date: string;
  newUsers: number;
  totalUsers: number;
  activeUsers: number;
};

export type UserActivityCounts = {
  date: string;
  count: number;
};

export type UserActivitySummary = {
  newUsers: number;
  totalUsers: number;
  activeUsers: number;
};

export type PayingAccessRow = {
  firstPaidAt: Date;
  expirationDate: Date;
};

export function isUserActivitySeriesKey(
  value: string | null | undefined,
): value is UserActivitySeriesKey {
  return USER_ACTIVITY_SERIES_KEYS.includes(value as UserActivitySeriesKey);
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
    activeUsers: UserActivityCounts[];
    usersBeforeWindow: number;
  },
  window: Pick<DashboardDateWindow, "fromDate" | "throughDate">,
): DailyUserActivity[] {
  const newUsersByDate = new Map(
    input.newUsers.map((row) => [row.date, row.count]),
  );
  const activeUsersByDate = new Map(
    input.activeUsers.map((row) => [row.date, row.count]),
  );
  const result: DailyUserActivity[] = [];
  let totalUsers = input.usersBeforeWindow;

  for (
    let date = window.fromDate;
    date <= window.throughDate;
    date = shiftCalendarDate(date, 1)
  ) {
    const newUsers = newUsersByDate.get(date) ?? 0;
    totalUsers += newUsers;
    result.push({
      date,
      newUsers,
      totalUsers,
      activeUsers: activeUsersByDate.get(date) ?? 0,
    });
  }

  return result;
}

export function summarizeUserActivity(
  daily: DailyUserActivity[],
): UserActivitySummary {
  const last = daily.at(-1);

  return {
    newUsers: daily.reduce((sum, row) => sum + row.newUsers, 0),
    totalUsers: last?.totalUsers ?? 0,
    activeUsers: last?.activeUsers ?? 0,
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

export function isActivePayingOnDate(
  row: PayingAccessRow,
  date: string,
  now: Date,
): boolean {
  return (
    formatBrtCalendarDate(row.firstPaidAt) <= date &&
    row.expirationDate.getTime() > activePayingReferenceTime(date, now).getTime()
  );
}

/**
 * Paying customers on each BRT day: a succeeded payment already existed
 * and expiration was still ahead of the same instant the base card uses.
 */
export function buildActiveUserStock(
  users: PayingAccessRow[],
  window: Pick<DashboardDateWindow, "fromDate" | "throughDate">,
  now: Date = new Date(),
): UserActivityCounts[] {
  const result: UserActivityCounts[] = [];

  for (
    let date = window.fromDate;
    date <= window.throughDate;
    date = shiftCalendarDate(date, 1)
  ) {
    let count = 0;
    for (const row of users) {
      if (isActivePayingOnDate(row, date, now)) count += 1;
    }
    result.push({ date, count });
  }

  return result;
}

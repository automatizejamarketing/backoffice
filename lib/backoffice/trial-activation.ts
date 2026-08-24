import {
  formatBrtCalendarDate,
  shiftCalendarDate,
  type DashboardDateWindow,
} from "./dashboard-date-range";

/** Internal daily target for trial activations (inclusive band). */
export const TRIAL_DAILY_GOAL = { min: 8, max: 13 } as const;

export type TrialActivationRecord = {
  userId: string;
  /** users.created_at — nullable in the schema. */
  signedUpAt: Date | null;
  /** First `trial_grant` credit transaction for the user. */
  activatedAt: Date;
};

export type DailyTrialActivation = {
  date: string;
  /** Users whose first trial started on this BRT day. */
  activations: number;
  /** Activated on the same BRT day the account was created. */
  sameDay: number;
  /** Account existed before this day (or signup date unknown). */
  existingAccount: number;
  /** Mean of (activatedAt − signedUpAt) in seconds; null when no data. */
  avgDelaySeconds: number | null;
  medianDelaySeconds: number | null;
};

export type TrialActivationSummary = {
  activations: number;
  days: number;
  avgPerDay: number;
  daysOnGoal: number;
  daysAboveGoal: number;
  daysBelowGoal: number;
  sameDay: number;
  existingAccount: number;
  existingAccountRate: number;
  avgDelaySeconds: number | null;
  medianDelaySeconds: number | null;
};

export type TrialActivationDashboard = {
  window: DashboardDateWindow;
  daily: DailyTrialActivation[];
  summary: TrialActivationSummary;
};

export type GoalStatus = "below" | "on" | "above";

export function goalStatus(activations: number): GoalStatus {
  if (activations < TRIAL_DAILY_GOAL.min) return "below";
  if (activations > TRIAL_DAILY_GOAL.max) return "above";
  return "on";
}

function delaySeconds(record: TrialActivationRecord): number | null {
  if (!record.signedUpAt) return null;
  const seconds =
    (record.activatedAt.getTime() - record.signedUpAt.getTime()) / 1000;
  // Clock skew between writers can produce tiny negatives; a trial can't
  // start before the account exists.
  return Math.max(0, seconds);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildTrialActivationDashboard(
  records: TrialActivationRecord[],
  window: DashboardDateWindow,
): TrialActivationDashboard {
  const byDate = new Map<
    string,
    { sameDay: number; existingAccount: number; delays: number[] }
  >();

  for (
    let date = window.fromDate;
    date <= window.throughDate;
    date = shiftCalendarDate(date, 1)
  ) {
    byDate.set(date, { sameDay: 0, existingAccount: 0, delays: [] });
  }

  const allDelays: number[] = [];

  for (const record of records) {
    const date = formatBrtCalendarDate(record.activatedAt);
    const bucket = byDate.get(date);
    // Records outside the window are ignored rather than creating stray days.
    if (!bucket) continue;

    const signedUpDate = record.signedUpAt
      ? formatBrtCalendarDate(record.signedUpAt)
      : null;
    if (signedUpDate === date) bucket.sameDay += 1;
    else bucket.existingAccount += 1;

    const delay = delaySeconds(record);
    if (delay !== null) {
      bucket.delays.push(delay);
      allDelays.push(delay);
    }
  }

  const daily: DailyTrialActivation[] = [...byDate.entries()].map(
    ([date, bucket]) => ({
      date,
      activations: bucket.sameDay + bucket.existingAccount,
      sameDay: bucket.sameDay,
      existingAccount: bucket.existingAccount,
      avgDelaySeconds: mean(bucket.delays),
      medianDelaySeconds: median(bucket.delays),
    }),
  );

  const activations = daily.reduce((acc, day) => acc + day.activations, 0);
  const sameDay = daily.reduce((acc, day) => acc + day.sameDay, 0);
  const existingAccount = activations - sameDay;
  const statuses = daily.map((day) => goalStatus(day.activations));

  return {
    window,
    daily,
    summary: {
      activations,
      days: daily.length,
      avgPerDay: daily.length === 0 ? 0 : round(activations / daily.length),
      daysOnGoal: statuses.filter((status) => status === "on").length,
      daysAboveGoal: statuses.filter((status) => status === "above").length,
      daysBelowGoal: statuses.filter((status) => status === "below").length,
      sameDay,
      existingAccount,
      existingAccountRate:
        activations === 0 ? 0 : round((existingAccount / activations) * 100),
      avgDelaySeconds: mean(allDelays),
      medianDelaySeconds: median(allDelays),
    },
  };
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const oneDecimal = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/**
 * Human duration for "time until trial": minutes under an hour, hours under a
 * day, otherwise days with one decimal.
 */
export function formatActivationDelay(
  seconds: number | null,
  fallback = "—",
): string {
  if (seconds === null || !Number.isFinite(seconds)) return fallback;
  if (seconds < MINUTE) return "< 1 min";
  if (seconds < HOUR) return `${Math.round(seconds / MINUTE)} min`;
  if (seconds < DAY) return `${oneDecimal.format(round(seconds / HOUR))} h`;
  const days = round(seconds / DAY);
  return `${oneDecimal.format(days)} ${days === 1 ? "dia" : "dias"}`;
}

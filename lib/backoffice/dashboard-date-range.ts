export const DASHBOARD_DATE_PRESETS = [
  "this_month",
  "last_30_days",
  "last_month",
] as const;

export type DashboardDatePreset =
  | (typeof DASHBOARD_DATE_PRESETS)[number]
  | "custom";

export type DashboardDateWindow = {
  preset: DashboardDatePreset;
  fromDate: string;
  throughDate: string;
  gte: Date;
  lt: Date;
};

export type DashboardDateSearchParams = {
  range?: string | string[];
  from?: string | string[];
  to?: string | string[];
};

const BRT_START_OF_DAY_UTC_HOUR = 3;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function formatBrtCalendarDate(date: Date): string {
  const shifted = new Date(
    date.getTime() - BRT_START_OF_DAY_UTC_HOUR * 60 * 60 * 1000,
  );
  return shifted.toISOString().slice(0, 10);
}

function isCalendarDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function shiftCalendarDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function firstDayOfMonth(value: string): string {
  return `${value.slice(0, 8)}01`;
}

function startOfPreviousMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1, 12))
    .toISOString()
    .slice(0, 10);
}

export function brtStartOfCalendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, BRT_START_OF_DAY_UTC_HOUR, 0, 0, 0),
  );
}

export function resolveDashboardDateWindow(
  params: DashboardDateSearchParams = {},
  now: Date = new Date(),
): DashboardDateWindow {
  const today = formatBrtCalendarDate(now);
  const requestedRange = firstValue(params.range);
  const preset = DASHBOARD_DATE_PRESETS.includes(
    requestedRange as (typeof DASHBOARD_DATE_PRESETS)[number],
  )
    ? (requestedRange as (typeof DASHBOARD_DATE_PRESETS)[number])
    : requestedRange === "custom"
      ? "custom"
      : "last_30_days";

  let fromDate: string;
  let throughDate: string;
  let normalizedPreset: DashboardDatePreset = preset;

  if (preset === "this_month") {
    fromDate = firstDayOfMonth(today);
    throughDate = today;
  } else if (preset === "last_month") {
    fromDate = startOfPreviousMonth(today);
    throughDate = shiftCalendarDate(firstDayOfMonth(today), -1);
  } else if (preset === "custom") {
    const customFrom = firstValue(params.from);
    const customTo = firstValue(params.to);
    if (
      isCalendarDate(customFrom) &&
      isCalendarDate(customTo) &&
      customFrom <= customTo &&
      customTo <= today
    ) {
      fromDate = customFrom;
      throughDate = customTo;
    } else {
      normalizedPreset = "last_30_days";
      fromDate = shiftCalendarDate(today, -29);
      throughDate = today;
    }
  } else {
    fromDate = shiftCalendarDate(today, -29);
    throughDate = today;
  }

  return {
    preset: normalizedPreset,
    fromDate,
    throughDate,
    gte: brtStartOfCalendarDate(fromDate),
    lt: brtStartOfCalendarDate(shiftCalendarDate(throughDate, 1)),
  };
}

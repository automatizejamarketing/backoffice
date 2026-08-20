export const PERFORMANCE_DATE_PRESETS = [
  "today",
  "yesterday",
  "last_7d",
  "last_14d",
  "last_30d",
  "this_month",
  "last_month",
] as const;

export type PerformanceDatePreset = (typeof PERFORMANCE_DATE_PRESETS)[number];

export type PerformanceReportFilters = {
  userId?: string;
  email?: string;
  accountId?: string;
  campaignId?: string;
  datePreset?: string;
  since?: string;
  until?: string;
  includeCreatives?: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function clampDatePreset(value: unknown): PerformanceDatePreset {
  const raw = String(value ?? "last_30d").trim();
  if ((PERFORMANCE_DATE_PRESETS as readonly string[]).includes(raw)) {
    return raw as PerformanceDatePreset;
  }
  return "last_30d";
}

export function parseReportFilters(input: PerformanceReportFilters): {
  accountId?: string;
  campaignId?: string;
  datePreset: PerformanceDatePreset;
  since?: string;
  until?: string;
  includeCreatives: boolean;
} {
  const since = input.since?.trim() || undefined;
  const until = input.until?.trim() || undefined;
  if ((since && !until) || (!since && until)) {
    throw new Error("Informe since e until juntos (YYYY-MM-DD), ou use datePreset.");
  }
  if (since && !ISO_DATE.test(since)) {
    throw new Error("since deve ser YYYY-MM-DD.");
  }
  if (until && !ISO_DATE.test(until)) {
    throw new Error("until deve ser YYYY-MM-DD.");
  }
  return {
    accountId: input.accountId?.trim() || undefined,
    campaignId: input.campaignId?.trim() || undefined,
    datePreset: clampDatePreset(input.datePreset),
    since,
    until,
    includeCreatives: Boolean(input.includeCreatives),
  };
}

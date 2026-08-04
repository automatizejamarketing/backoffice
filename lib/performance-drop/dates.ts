import { PERFORMANCE_DROP_TIME_ZONE } from "@/lib/performance-drop/constants";

/** YYYY-MM-DD in America/Sao_Paulo. */
export function businessDateKey(
  date: Date,
  timeZone = PERFORMANCE_DROP_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function wasCapturedOnBusinessDay(
  capturedAt: Date | string | null,
  referenceDate = new Date(),
): boolean {
  if (!capturedAt) return false;
  const date = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return false;
  return businessDateKey(date) === businessDateKey(referenceDate);
}

/** Shift a YYYY-MM-DD calendar date by `days` (UTC noon to avoid DST edges). */
export function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Given Meta's `last_7d` date_start / date_stop, return the preceding 7-day
 * window (inclusive).
 */
export function previousSevenDayRange(current: {
  since: string;
  until: string;
}): { since: string; until: string } {
  const until = shiftYmd(current.since, -1);
  const since = shiftYmd(until, -6);
  return { since, until };
}

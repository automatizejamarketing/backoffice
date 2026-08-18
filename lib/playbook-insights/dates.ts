import {
  PLAYBOOK_INSIGHTS_TIME_ZONE,
  PLAYBOOK_RECENT_SPEND_DAYS,
} from "./constants";

/** YYYY-MM-DD in the playbook business timezone. */
export function playbookBusinessDateKey(
  date: Date,
  timeZone = PLAYBOOK_INSIGHTS_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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
 * Inclusive trailing calendar window ending today in the playbook timezone.
 * 10 days including today = today and the previous 9 calendar days.
 */
export function trailingInclusiveRange(
  now = new Date(),
  days = PLAYBOOK_RECENT_SPEND_DAYS,
): { since: string; until: string } {
  const until = playbookBusinessDateKey(now);
  const since = shiftYmd(until, -(Math.max(1, days) - 1));
  return { since, until };
}

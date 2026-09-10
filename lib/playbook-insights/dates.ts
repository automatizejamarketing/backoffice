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

export function wasCapturedOnPlaybookBusinessDay(
  capturedAt: Date | string | null,
  referenceDate = new Date(),
): boolean {
  if (!capturedAt) return false;
  const date = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return false;
  return playbookBusinessDateKey(date) === playbookBusinessDateKey(referenceDate);
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

/** Inclusive window immediately before `current`, same length. */
export function previousInclusiveRange(current: {
  since: string;
  until: string;
}): { since: string; until: string } {
  const until = shiftYmd(current.since, -1);
  const lengthDays = inclusiveDayCount(current.since, current.until);
  const since = shiftYmd(until, -(lengthDays - 1));
  return { since, until };
}

export function adjacentInclusiveRanges(
  now = new Date(),
  days: number,
): {
  current: { since: string; until: string };
  previous: { since: string; until: string };
} {
  const current = trailingInclusiveRange(now, days);
  return { current, previous: previousInclusiveRange(current) };
}

function inclusiveDayCount(since: string, until: string): number {
  const start = Date.parse(`${since}T12:00:00.000Z`);
  const end = Date.parse(`${until}T12:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 1;
  }
  return Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

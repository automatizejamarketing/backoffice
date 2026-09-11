const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function inclusiveDays(start: string, end: string): number {
  const ms = parseDateOnly(end).getTime() - parseDateOnly(start).getTime();
  return Math.floor(ms / DAY_MS) + 1;
}

/** Last complete Mon–Sun week ending before `now` (UTC calendar, used as SP proxy). */
export function lastCompleteWeek(now = new Date()): {
  start: string;
  end: string;
} {
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const weekday = utc.getUTCDay(); // 0 Sun
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  const thisMonday = addDays(utc, -daysSinceMonday);
  const lastSunday = addDays(thisMonday, -1);
  const lastMonday = addDays(lastSunday, -6);
  return {
    start: formatDateOnly(lastMonday),
    end: formatDateOnly(lastSunday),
  };
}

export function lastCompleteMonth(now = new Date()): {
  start: string;
  end: string;
} {
  const firstOfThisMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const lastOfPrev = addDays(firstOfThisMonth, -1);
  const firstOfPrev = new Date(
    Date.UTC(lastOfPrev.getUTCFullYear(), lastOfPrev.getUTCMonth(), 1),
  );
  return {
    start: formatDateOnly(firstOfPrev),
    end: formatDateOnly(lastOfPrev),
  };
}

export function previousWindow(start: string, end: string): {
  start: string;
  end: string;
} {
  const days = inclusiveDays(start, end);
  const prevEnd = addDays(parseDateOnly(start), -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return {
    start: formatDateOnly(prevStart),
    end: formatDateOnly(prevEnd),
  };
}

export function daysUntil(date: Date, now = new Date()): number {
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const end = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return Math.round((end - start) / DAY_MS);
}

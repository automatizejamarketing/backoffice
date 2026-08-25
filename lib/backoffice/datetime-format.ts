export const BACKOFFICE_TIME_ZONE = "America/Sao_Paulo";

/** A bare calendar day (`2026-08-01`), as opposed to an instant in time. */
const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Anchor a calendar day at noon UTC, or `null` if the day does not exist.
 *
 * Noon is deliberate: it keeps the date inside the same day for every offset
 * this app renders in, so the day never shifts when formatted.
 *
 * `Date.UTC` rolls overflow forward — month 13 silently becomes January of the
 * next year — which would turn impossible input into a plausible-looking date.
 * Round-tripping the components rejects it so the caller can fall back instead.
 */
function calendarDayToInstant(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

/**
 * Anchor a calendar day at noon UTC. Impossible days yield an Invalid Date,
 * which the formatters render as their fallback.
 */
export function parseCalendarDate(value: string): Date {
  return calendarDayToInstant(value) ?? new Date(NaN);
}

/**
 * Accepts both shapes the callers hand us: real instants (timestamps out of
 * Postgres, Stripe, Meta `start_time`) and bare calendar days.
 *
 * The distinction matters because `new Date("2026-08-01")` parses a date-only
 * string as midnight *UTC* per ECMA-262 — rendering that in São Paulo (UTC-3)
 * rolls the clock back to 21:00 of the **previous day**. A calendar day carries
 * no time to preserve, so it goes through {@link calendarDayToInstant} instead.
 *
 * Note that a date-only value formatted by one of the *time* helpers will show
 * the anchor hour (09:00 in São Paulo). There is no real time in the input —
 * pair calendar days with the date-only helpers.
 */
function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;

  const date = value instanceof Date
    ? value
    : CALENDAR_DAY_PATTERN.test(value)
      ? calendarDayToInstant(value)
      : new Date(value);

  if (!date || Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatInSaoPaulo(
  value: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback = "—",
): string {
  const date = parseDate(value);
  if (!date) return fallback;

  return new Intl.DateTimeFormat("pt-BR", {
    ...options,
    timeZone: BACKOFFICE_TIME_ZONE,
  }).format(date);
}

export function formatDateInSaoPaulo(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  return formatInSaoPaulo(value, { dateStyle: "medium" }, fallback);
}

export function formatShortDateInSaoPaulo(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  return formatInSaoPaulo(value, { dateStyle: "short" }, fallback);
}

export function formatNumericDateInSaoPaulo(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  return formatInSaoPaulo(
    value,
    { day: "2-digit", month: "2-digit", year: "numeric" },
    fallback,
  );
}

export function formatDateTimeInSaoPaulo(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  return formatInSaoPaulo(
    value,
    { dateStyle: "medium", timeStyle: "short" },
    fallback,
  );
}

export function formatShortDateTimeInSaoPaulo(
  value: Date | string | null | undefined,
  fallback = "Nunca",
): string {
  return formatInSaoPaulo(
    value,
    { dateStyle: "short", timeStyle: "short" },
    fallback,
  );
}

export function formatTimeInSaoPaulo(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  return formatInSaoPaulo(value, { timeStyle: "short" }, fallback);
}

export function formatChartDateInSaoPaulo(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  return formatInSaoPaulo(
    value,
    { day: "2-digit", month: "short" },
    fallback,
  );
}

/** Calendar-day values (e.g. subscription expiration) stored as UTC instants. */
export function formatCalendarDayInSaoPaulo(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  return formatInSaoPaulo(value, {}, fallback);
}

export function formatCalendarDateLabel(value: string): string {
  return formatInSaoPaulo(parseCalendarDate(value), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatCalendarWeekdayLabel(value: string): string {
  return formatInSaoPaulo(parseCalendarDate(value), {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).replace(/,\s*/g, " ");
}

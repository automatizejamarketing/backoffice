export const BACKOFFICE_TIME_ZONE = "America/Sao_Paulo";

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
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

export function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

export function formatCalendarDateLabel(value: string): string {
  return formatInSaoPaulo(parseCalendarDate(value), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

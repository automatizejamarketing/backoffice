export type BudgetType = "daily" | "lifetime";

type BudgetSource = {
  dailyBudget?: string;
  lifetimeBudget?: string;
};

function hasPositiveMinorUnits(value?: string): boolean {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function getBudgetType(source: BudgetSource): BudgetType {
  return hasPositiveMinorUnits(source.lifetimeBudget) ? "lifetime" : "daily";
}

export function minorUnitsToCurrencyInput(value?: string): string {
  if (!value) return "";
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return "";
  return (parsed / 100).toFixed(2);
}

export function currencyToMinorUnits(value: number): string {
  return Math.round(value * 100).toString();
}

export function metaDateToDateTimeLocal(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (n: number) => n.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

export function dateTimeLocalToMeta(value: string): string {
  return new Date(value).toISOString();
}

export function isValidDateTimeLocal(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(new Date(value).getTime());
}

export function isEndAfterStart(startTime: string, endTime: string): boolean {
  return new Date(endTime).getTime() > new Date(startTime).getTime();
}

const MIN_CAMPAIGN_RUNTIME_MS = 60 * 60 * 1000;

export function hasMinimumRuntime(startIso: string, endIso: string): boolean {
  return (
    new Date(endIso).getTime() - new Date(startIso).getTime() >=
    MIN_CAMPAIGN_RUNTIME_MS
  );
}

export function isEndInFuture(endIso: string): boolean {
  return new Date(endIso).getTime() > Date.now();
}

export function isStartInPast(startIso: string | null | undefined): boolean {
  if (!startIso) return false;
  const t = new Date(startIso).getTime();
  return Number.isFinite(t) && t <= Date.now();
}

/** Timestamp truncated to the minute — Meta stores seconds the pickers can't express. */
export function toMinuteTimestamp(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setSeconds(0, 0);
  return date.getTime();
}

export function hasScheduleMinuteChange(
  currentValue: string | null | undefined,
  nextValue: string,
): boolean {
  const currentTimestamp = toMinuteTimestamp(currentValue);
  const nextTimestamp = toMinuteTimestamp(nextValue);
  return nextTimestamp !== null && currentTimestamp !== nextTimestamp;
}

/**
 * Per-ad-set schedule params when a CAMPAIGN-level window is saved.
 *
 * `applyStart`/`applyEnd` say whether the USER actually moved that end of the
 * campaign window. They exist because the edit dialog can only show the
 * campaign's own start/stop while each ad set carries its own — a duplicated
 * ad set legitimately starts minutes or days apart from its campaign. Without
 * the flags, that pre-existing drift read as "the user is changing the start"
 * and a pure budget edit died with "A data de início não pode ser alterada"
 * even though the user never touched the dates.
 *
 * With `applyStart`, a start that truly changed still refuses on ad sets that
 * already started — Meta rejects start_time on started sets (subcode 1487057),
 * even when only the end date is being edited.
 */
export function buildAdSetScheduleUpdateParams(
  adSet: { start_time?: string | null; end_time?: string | null },
  nextStartIso: string,
  nextEndIso: string,
  opts: { applyStart?: boolean; applyEnd?: boolean } = {},
): URLSearchParams | { error: string } {
  const { applyStart = true, applyEnd = true } = opts;
  const params = new URLSearchParams();
  const startChanged =
    applyStart && hasScheduleMinuteChange(adSet.start_time, nextStartIso);
  const endChanged =
    applyEnd && hasScheduleMinuteChange(adSet.end_time, nextEndIso);

  if (startChanged) {
    if (isStartInPast(adSet.start_time)) {
      return {
        error:
          "A data de início não pode ser alterada em conjuntos que já começaram. Altere apenas a data de término.",
      };
    }
    params.set("start_time", new Date(nextStartIso).toISOString());
  }

  if (endChanged) {
    params.set("end_time", new Date(nextEndIso).toISOString());
  }

  return params;
}

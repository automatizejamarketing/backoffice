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

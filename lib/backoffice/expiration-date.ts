import { TZDateMini } from "@date-fns/tz";
import { BACKOFFICE_TIME_ZONE } from "./datetime-format";

/** Calendar selection, independent of the browser's UTC offset. */
export function expirationCalendarInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Convert a stored instant to the local Date expected by the calendar. */
export function expirationCalendarDate(date: Date): Date {
  const zoned = new TZDateMini(date, BACKOFFICE_TIME_ZONE);
  return new Date(zoned.getFullYear(), zoned.getMonth(), zoned.getDate(), 12);
}

/** Access remains valid through the selected day in São Paulo. */
export function expirationInputToEndOfDay(input: unknown): Date {
  if (typeof input !== "string") throw new Error("Invalid date");
  // Both backoffice endpoints historically accept YYYY-MM-DD or an ISO date.
  const datePart = input.trim().split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) throw new Error("Invalid date");
  const [year, month, day] = datePart.split("-").map(Number);
  const date = new TZDateMini(year, month - 1, day, 23, 59, 59, 999, BACKOFFICE_TIME_ZONE);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error("Invalid date");
  }
  return new Date(date.getTime());
}

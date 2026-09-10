/** Calendar dates in the user's local timezone, never UTC timestamps. */
export type DateRange = { from: Date; to: Date };
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return dateKey(date) === value ? date : undefined;
}
export function formatDate(date?: Date) {
  return date ? date.toLocaleDateString("pt-BR") : "";
}
export function isDateAllowed(date: Date, minDate?: Date, maxDate?: Date) {
  if (!Number.isFinite(date.getTime())) return false;
  const key = dateKey(date);
  return (
    (!minDate || key >= dateKey(minDate)) &&
    (!maxDate || key <= dateKey(maxDate))
  );
}
export function validateDateRange(
  from: string,
  to: string,
  minDate?: Date,
  maxDate?: Date,
): string | null {
  const start = parseDate(from),
    end = parseDate(to);
  if (!start || !end) return "Informe as datas de início e fim.";
  if (from > to) return "O fim deve ser igual ou posterior ao início.";
  if (
    !isDateAllowed(start, minDate, maxDate) ||
    !isDateAllowed(end, minDate, maxDate)
  )
    return "Escolha datas dentro do período permitido.";
  return null;
}
export type DatePreset = { id: string; label: string; range: DateRange };
export function getDatePresets(today = new Date()): DatePreset[] {
  const day = (offset: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return [
    { id: "today", label: "Hoje", range: { from: day(0), to: day(0) } },
    { id: "yesterday", label: "Ontem", range: { from: day(-1), to: day(-1) } },
    {
      id: "last7Days",
      label: "Últimos 7 dias",
      range: { from: day(-6), to: day(0) },
    },
    {
      id: "last30Days",
      label: "Últimos 30 dias",
      range: { from: day(-29), to: day(0) },
    },
    {
      id: "monthToDate",
      label: "Este mês",
      range: {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: day(0),
      },
    },
    {
      id: "lastMonth",
      label: "Mês passado",
      range: {
        from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        to: new Date(today.getFullYear(), today.getMonth(), 0),
      },
    },
  ];
}

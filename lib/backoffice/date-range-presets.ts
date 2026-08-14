import {
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subQuarters,
  subWeeks,
  subYears,
} from "date-fns";
import type { DateRange } from "react-day-picker";

const WEEK_STARTS_ON_MONDAY = { weekStartsOn: 1 as const };

export type DateRangePreset = {
  label: string;
  range: DateRange;
};

export function buildDateRangePresets(today: Date): DateRangePreset[] {
  const yesterday = subDays(today, 1);
  const lastWeek = subWeeks(today, 1);
  const lastMonth = subMonths(today, 1);
  const lastQuarter = subQuarters(today, 1);
  const lastYear = subYears(today, 1);

  return [
    { label: "Hoje", range: { from: today, to: today } },
    { label: "Ontem", range: { from: yesterday, to: yesterday } },
    { label: "Últimos 7 dias", range: { from: subDays(today, 6), to: today } },
    { label: "Hoje e ontem", range: { from: yesterday, to: today } },
    { label: "Últimos 14 dias", range: { from: subDays(today, 13), to: today } },
    { label: "Últimos 28 dias", range: { from: subDays(today, 27), to: today } },
    { label: "Últimos 30 dias", range: { from: subDays(today, 29), to: today } },
    {
      label: "Esta semana",
      range: { from: startOfWeek(today, WEEK_STARTS_ON_MONDAY), to: today },
    },
    {
      label: "Semana passada",
      range: {
        from: startOfWeek(lastWeek, WEEK_STARTS_ON_MONDAY),
        to: endOfWeek(lastWeek, WEEK_STARTS_ON_MONDAY),
      },
    },
    { label: "Este mês", range: { from: startOfMonth(today), to: today } },
    {
      label: "Mês passado",
      range: { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) },
    },
    {
      label: "Este trimestre",
      range: { from: startOfQuarter(today), to: today },
    },
    {
      label: "Trimestre passado",
      range: {
        from: startOfQuarter(lastQuarter),
        to: endOfQuarter(lastQuarter),
      },
    },
    { label: "Este ano", range: { from: startOfYear(today), to: today } },
    {
      label: "Ano passado",
      range: { from: startOfYear(lastYear), to: endOfYear(lastYear) },
    },
    { label: "Últimos 90 dias", range: { from: subDays(today, 89), to: today } },
    {
      label: "Últimos 3 meses",
      range: { from: subMonths(today, 3), to: today },
    },
    {
      label: "Últimos 6 meses",
      range: { from: subMonths(today, 6), to: today },
    },
    {
      label: "Últimos 12 meses",
      range: { from: subMonths(today, 12), to: today },
    },
  ];
}

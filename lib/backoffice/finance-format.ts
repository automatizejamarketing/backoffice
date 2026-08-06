import {
  formatCalendarDateLabel,
  formatDateTimeInSaoPaulo,
  parseCalendarDate,
} from "@/lib/backoffice/datetime-format";

export function formatFinanceNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatFinancePercentage(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatBRLFromCentavos(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function formatFinanceDateTime(value: Date | string | null | undefined) {
  return formatDateTimeInSaoPaulo(value);
}

export { formatCalendarDateLabel, parseCalendarDate };

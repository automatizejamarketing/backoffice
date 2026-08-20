import { formatDateTimeInSaoPaulo } from "@/lib/backoffice/datetime-format";

export function formatReportMoney(
  value: number | null,
  currency: string | null,
): string {
  if (value === null) return "—";
  const code = currency?.trim().toUpperCase() || "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  }
}

export function formatReportRoas(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}x`;
}

export function formatReportInteger(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(
    value,
  );
}

export function formatReportShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!(year && month && day)) return iso;
  return `${day}/${month}`;
}

export function formatGeneratedAt(iso: string): string {
  return formatDateTimeInSaoPaulo(iso);
}

export function statusClass(tag: string): string {
  if (tag === "ATIVA") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (tag === "PAUSADA") {
    return "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300";
  }
  return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300";
}

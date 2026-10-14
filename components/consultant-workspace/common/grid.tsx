"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { budgetPacing, formatMoney, formatPct } from "@/lib/consultant-workspace/metrics";

export type SortDir = "asc" | "desc";
export type Density = "compacta" | "confortavel";

/**
 * Estilo das células definido uma vez na tabela (não em cada <td>): a Mesa tem
 * centenas de linhas × 14 colunas e classes repetidas inchavam o HTML.
 */
export function tableClass(density: Density) {
  return cn(
    "w-full border-separate border-spacing-0",
    "[&_tbody_td]:border-b [&_tbody_td]:border-border/70 [&_tbody_td]:px-3 [&_tbody_td]:whitespace-nowrap [&_tbody_td]:align-middle",
    "[&_tbody_tr:hover>td]:bg-muted",
    density === "compacta"
      ? "[&_tbody_td]:h-9 [&_tbody_td]:py-1 [&_tbody_td]:text-xs"
      : "[&_tbody_td]:h-12 [&_tbody_td]:py-2 [&_tbody_td]:text-[13px]",
  );
}

export const headClass =
  "sticky top-0 z-20 border-b bg-background px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase whitespace-nowrap";

export function SortHeader({
  label,
  hint,
  active,
  dir,
  align = "left",
  onSort,
}: {
  label: string;
  hint?: string;
  active: boolean;
  dir: SortDir;
  align?: "left" | "right";
  onSort?: () => void;
}) {
  if (!onSort) {
    return (
      <span className={cn("inline-flex", align === "right" && "w-full justify-end")} title={hint}>
        {label}
      </span>
    );
  }
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      title={hint}
      onClick={onSort}
      className={cn(
        "group/sort inline-flex items-center gap-1 uppercase hover:text-foreground",
        align === "right" && "w-full flex-row-reverse justify-start",
        active && "text-foreground",
      )}
    >
      {label}
      <Icon className={cn("size-3 shrink-0", !active && "opacity-0 group-hover/sort:opacity-60")} />
    </button>
  );
}

export type Pacing = ReturnType<typeof budgetPacing>;

export function pacingTone(ratio: number) {
  if (ratio >= 0.9 && ratio <= 1.1) return "ok" as const;
  if (ratio < 0.7 || ratio > 1.3) return "bad" as const;
  return "warn" as const;
}

export function pacingText(ratio: number) {
  const diff = ratio - 1;
  if (Math.abs(diff) < 0.05) return "no ritmo";
  return `${formatPct(diff)} ${diff > 0 ? "acima" : "abaixo"} do ritmo`;
}

/** Barra fina: preenchimento = gasto do mês / verba; traço = onde deveria estar hoje. */
export function PacingBar({
  monthToDate,
  monthlyBudget,
  pacing,
  className,
}: {
  monthToDate: number;
  monthlyBudget: number;
  pacing: NonNullable<Pacing>;
  className?: string;
}) {
  const tone = pacingTone(pacing.ratio);
  const fill = Math.min(1, monthToDate / monthlyBudget);
  const marker = Math.min(1, pacing.expected / monthlyBudget);
  return (
    <div
      className={cn("space-y-1", className)}
      title={`Gasto no mês ${formatMoney(monthToDate, false)} de ${formatMoney(monthlyBudget, false)} · esperado até ontem ${formatMoney(pacing.expected, false)} · projeção do mês ${formatMoney(pacing.projected, false)}`}
    >
      <div
        className={cn(
          "text-[11px] leading-none tabular-nums",
          tone === "ok" && "text-emerald-700 dark:text-emerald-400",
          tone === "warn" && "text-amber-700 dark:text-amber-400",
          tone === "bad" && "text-red-700 dark:text-red-400",
        )}
      >
        {pacingText(pacing.ratio)}
      </div>
      <div className="relative h-1 w-full min-w-20 overflow-visible rounded-full bg-muted-foreground/15">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "ok" && "bg-emerald-500",
            tone === "warn" && "bg-amber-500",
            tone === "bad" && "bg-red-500",
          )}
          style={{ width: `${fill * 100}%` }}
        />
        <div
          className="absolute -top-0.5 h-2 w-px bg-foreground/60"
          style={{ left: `${marker * 100}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

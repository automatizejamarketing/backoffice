"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  META_HEALTH_LABEL,
  PLAN_LABEL,
  formatPct,
  goalStatus,
  type GoalStatus,
} from "@/lib/consultant-workspace/metrics";
import type { PlanTier, PrimaryKpi, WorkspaceClient, WorkspaceGoal } from "@/lib/consultant-workspace/types";

const PLAN_STYLE: Record<PlanTier, string> = {
  premium:
    "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
  pro: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  starter:
    "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  sem_plano:
    "border-dashed border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
};

export function PlanBadge({ tier, className }: { tier: PlanTier; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        PLAN_STYLE[tier],
        className,
      )}
    >
      {PLAN_LABEL[tier]}
    </span>
  );
}

const META_STYLE: Record<WorkspaceClient["meta"]["health"], string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  token_invalido: "text-red-700 dark:text-red-400",
  erro_checagem: "text-amber-700 dark:text-amber-400",
  checagem_velha: "text-amber-700 dark:text-amber-400",
  sem_meta: "text-muted-foreground",
};

export function MetaHealthBadge({
  health,
  detail,
  compact,
}: {
  health: WorkspaceClient["meta"]["health"];
  detail?: string | null;
  compact?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs", META_STYLE[health])}
      title={detail ?? undefined}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          health === "ok"
            ? "bg-emerald-500"
            : health === "token_invalido"
              ? "bg-red-500"
              : health === "sem_meta"
                ? "bg-zinc-400"
                : "bg-amber-500",
        )}
      />
      {compact && health === "ok" ? null : META_HEALTH_LABEL[health]}
    </span>
  );
}

const GOAL_STYLE: Record<GoalStatus, string> = {
  na_meta: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  perto: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  fora: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  sem_meta: "bg-muted text-muted-foreground",
  sem_dados: "bg-muted text-muted-foreground",
};

const GOAL_LABEL: Record<GoalStatus, string> = {
  na_meta: "Na meta",
  perto: "Perto",
  fora: "Fora da meta",
  sem_meta: "Sem meta",
  sem_dados: "Sem dados",
};

export function GoalBadge({ kpi, goal }: { kpi: PrimaryKpi; goal: WorkspaceGoal | undefined }) {
  const { status } = goalStatus(kpi, goal);
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium", GOAL_STYLE[status])}>
      {GOAL_LABEL[status]}
    </span>
  );
}

/**
 * Variação contra o período anterior. `goodWhenUp` diz a direção boa
 * (gasto e resultados: neutro/sobe; custo: desce).
 */
export function Delta({
  value,
  goodWhenUp = true,
  neutral = false,
  className,
}: {
  value: number | null;
  goodWhenUp?: boolean;
  neutral?: boolean;
  className?: string;
}) {
  if (value == null) return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  const flat = Math.abs(value) < 0.03;
  const good = flat || neutral ? null : value > 0 === goodWhenUp;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs tabular-nums",
        good === true && "text-emerald-700 dark:text-emerald-400",
        good === false && "text-red-700 dark:text-red-400",
        good === null && "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3" />
      {formatPct(value)}
    </span>
  );
}

export function Sparkline({
  values,
  width = 96,
  height = 24,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 0.0001);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((value, index) => `${(index * step).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("text-primary", className)}
      aria-hidden
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function SeverityDot({ severity }: { severity: "critical" | "warning" | "info" }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        severity === "critical" ? "bg-red-500" : severity === "warning" ? "bg-amber-500" : "bg-sky-500",
      )}
      title={severity === "critical" ? "Crítico" : severity === "warning" ? "Atenção" : "Informativo"}
    />
  );
}

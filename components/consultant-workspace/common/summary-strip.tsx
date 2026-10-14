"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLAN_SERVICE } from "@/lib/consultant-workspace/metrics";
import type { CarteiraRow, PlanGroup } from "./model";

export type StripCounts = {
  premium: { need: number; total: number };
  pro: { need: number; total: number; critical: number; onboarding: number };
  starter: { need: number; total: number; broken: number };
};

type Tone = "violet" | "red" | "amber" | "ok";

/** O que está "na fila" por plano, nas linhas já filtradas (carteira, busca, etapa, problema). */
export function computeStripCounts(rows: CarteiraRow[]): { counts: StripCounts; remaining: number } {
  const need = (group: PlanGroup) => rows.filter((row) => row.planGroup === group && row.bucket === "fila");
  const premiumNeed = need("premium");
  const proNeed = need("pro");
  const starterNeed = need("starter");
  return {
    counts: {
      premium: { need: premiumNeed.length, total: rows.filter((row) => row.planGroup === "premium").length },
      pro: {
        need: proNeed.length,
        total: rows.filter((row) => row.planGroup === "pro").length,
        critical: proNeed.filter((row) => row.worst === "critical").length,
        onboarding: proNeed.filter((row) => row.trafficSignals.some((signal) => signal.kind === "onboarding")).length,
      },
      starter: {
        need: starterNeed.length,
        total: rows.filter((row) => row.planGroup === "starter").length,
        broken: starterNeed.filter((row) => row.trafficSignals.some((signal) => signal.kind === "meta")).length,
      },
    },
    remaining: premiumNeed.length + proNeed.length + starterNeed.length,
  };
}

/**
 * Resumo por plano, igual nas três visões: um cartão por plano, com o que o
 * plano promete. Clicar filtra pelo plano (clicar de novo limpa).
 */
export function SummaryStrip({
  counts,
  plan,
  onPlan,
  handled,
  remaining,
}: {
  counts: StripCounts;
  plan: PlanGroup | null;
  onPlan: (plan: PlanGroup | null) => void;
  handled: number;
  remaining: number;
}) {
  const { premium, pro, starter } = counts;
  const cards: Array<{ key: PlanGroup; count: number; label: string; sub: string; tone: Tone }> = [
    {
      key: "premium",
      count: premium.need,
      label: premium.need === 1 ? "Premium precisa de você hoje" : "Premium precisam de você hoje",
      sub: `de ${premium.total}`,
      tone: premium.need > 0 ? "violet" : "ok",
    },
    {
      key: "pro",
      count: pro.need,
      label: "Pro com problema",
      sub:
        [
          pro.critical > 0 ? `${pro.critical} crítico${pro.critical === 1 ? "" : "s"}` : null,
          pro.onboarding > 0 ? `${pro.onboarding} no onboarding` : null,
        ]
          .filter(Boolean)
          .join(" · ") || `de ${pro.total}`,
      tone: pro.critical > 0 ? "red" : pro.need > 0 ? "amber" : "ok",
    },
    {
      key: "starter",
      count: starter.need,
      label: "Starter com exceção",
      sub: starter.broken > 0 ? `${starter.broken} com conexão quebrada` : `de ${starter.total}`,
      tone: starter.need > 0 ? "amber" : "ok",
    },
  ];
  const total = handled + remaining;
  const progress = total > 0 ? handled / total : 1;

  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-2 @4xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(180px,0.8fr)]">
        {cards.map((card) => {
          const active = plan === card.key;
          return (
            <button
              key={card.key}
              type="button"
              aria-pressed={active}
              title={`${PLAN_SERVICE[card.key]}. ${active ? "Clique para ver todos os planos." : "Clique para filtrar."}`}
              onClick={() => onPlan(active ? null : card.key)}
              className={cn(
                "group flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-foreground/25",
                card.tone === "red" && "border-red-300 dark:border-red-900",
                card.tone === "violet" && "border-violet-300 dark:border-violet-900",
                active && "border-foreground/60 bg-muted/60 ring-1 ring-foreground/30 dark:border-foreground/50",
              )}
            >
              <span
                className={cn(
                  "text-2xl leading-none font-semibold tabular-nums",
                  card.tone === "red" && "text-red-600 dark:text-red-400",
                  card.tone === "amber" && "text-amber-600 dark:text-amber-400",
                  card.tone === "violet" && "text-violet-700 dark:text-violet-300",
                  card.tone === "ok" && "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {card.count}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-medium">{card.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{card.sub}</span>
              </span>
              {active ? (
                <span className="flex shrink-0 items-center gap-0.5 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">
                  <Check className="size-3" /> filtro
                </span>
              ) : null}
            </button>
          );
        })}
        <div className="flex min-w-0 flex-col justify-center gap-1.5 rounded-lg border bg-card px-3 py-2">
          <p className="flex items-baseline gap-1.5 text-[13px]">
            <span className="text-muted-foreground">Você tratou</span>
            <span className="text-lg leading-none font-semibold tabular-nums">{handled}</span>
            <span className="text-muted-foreground">hoje</span>
          </p>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">faltam {remaining}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

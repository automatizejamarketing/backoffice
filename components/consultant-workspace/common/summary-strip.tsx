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
 * Resumo por plano, igual nas três visões: uma faixa fina (40px) com o que
 * cada plano promete e, no fim, quanto você já tratou hoje. Clicar num plano
 * filtra por ele (clicar de novo limpa). Cor só no número: violeta para
 * Premium esperando, vermelho para Pro com crítico.
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
      <div className="flex h-10 min-w-0 items-stretch overflow-hidden rounded-lg border bg-card text-xs">
        {cards.map((card) => {
          const active = plan === card.key;
          return (
            <button
              key={card.key}
              type="button"
              aria-pressed={active}
              title={`${card.count} ${card.label} (${card.sub}). ${PLAN_SERVICE[card.key]}. ${active ? "Clique para ver todos os planos." : "Clique para filtrar."}`}
              onClick={() => onPlan(active ? null : card.key)}
              className={cn(
                "flex min-w-0 flex-[1_1_auto] items-center gap-2 border-r px-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none @3xl:px-3",
                active && "bg-muted",
              )}
            >
              <span
                className={cn(
                  "text-base leading-none font-semibold tabular-nums",
                  card.tone === "red" && "text-red-600 dark:text-red-400",
                  card.tone === "violet" && "text-violet-700 dark:text-violet-300",
                  card.tone === "ok" && "text-muted-foreground",
                )}
              >
                {card.count}
              </span>
              <span className="min-w-0 flex-1 truncate leading-tight">
                <span className="font-medium">{card.label}</span>
                <span className="hidden text-muted-foreground @5xl:inline"> · {card.sub}</span>
              </span>
              {active ? <Check className="size-3.5 shrink-0" aria-label="filtro ativo" /> : null}
            </button>
          );
        })}
        <div
          className="flex shrink-0 items-center gap-2 px-2.5 @3xl:px-3"
          title={`Você tratou ${handled} hoje; faltam ${remaining} na fila`}
        >
          <span className="whitespace-nowrap text-muted-foreground">
            Você tratou <span className="text-sm font-semibold text-foreground tabular-nums">{handled}</span> hoje
          </span>
          <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted @4xl:block" aria-hidden>
            <span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress * 100}%` }} />
          </span>
          <span className="hidden whitespace-nowrap text-[11px] text-muted-foreground tabular-nums @4xl:inline">
            faltam {remaining}
          </span>
        </div>
      </div>
    </div>
  );
}

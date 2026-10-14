"use client";

import { Fragment } from "react";
import { Check, ChevronRight, Sparkles, TriangleAlert, Wallet } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { STAGE_LABEL, type ClientJourney, type JourneyStage, type ProblemTag } from "@/lib/consultant-workspace/journey";
import { PLAN_LABEL } from "@/lib/consultant-workspace/metrics";
import type { PlanTier } from "@/lib/consultant-workspace/types";
import { daysInStageText } from "./model";

/** Peças da jornada usadas pelas três visões e pela página do cliente. */

export const STAGE_SHORT: Record<JourneyStage, string> = {
  onboarding: "Onboarding",
  rodando: "Rodando",
  parado: "Parado",
};

const STAGE_STYLE: Record<JourneyStage, string> = {
  onboarding: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  rodando:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  parado: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
};

export const STAGE_DOT: Record<JourneyStage, string> = {
  onboarding: "bg-sky-500",
  rodando: "bg-emerald-500",
  parado: "bg-zinc-400",
};

export function StagePill({
  stage,
  short,
  size = "sm",
  className,
}: {
  stage: JourneyStage;
  short?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "md" ? "px-2 py-0.5 text-xs" : "px-1.5 py-px text-[11px]",
        STAGE_STYLE[stage],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", STAGE_DOT[stage])} />
      {short ? STAGE_SHORT[stage] : STAGE_LABEL[stage]}
    </span>
  );
}

export function StageDot({ stage, className }: { stage: JourneyStage; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STAGE_DOT[stage], className)} />;
}

/** Uma linha: em que etapa está e o que trava. */
export function stageLine(journey: ClientJourney): string {
  if (journey.stage === "onboarding") {
    const days = journey.daysInStage;
    return journey.blocker
      ? `travado em “${journey.blocker.label}”${days != null ? ` · ${days === 0 ? "hoje" : `${days} d`}` : ""}`
      : (daysInStageText(journey) ?? "");
  }
  if (journey.stage === "parado") return daysInStageText(journey) ?? "sem gasto no período";
  return journey.attentionReasons[0] ?? daysInStageText(journey) ?? "";
}

/** Os 6 passos do onboarding, compactos (painel da Fila) ou largos (página do cliente). */
export function JourneyStepper({ journey, compact }: { journey: ClientJourney; compact?: boolean }) {
  const blockerKey = journey.blocker?.key ?? null;
  const days = daysInStageText(journey);
  if (compact) {
    return (
      <div className="space-y-1.5">
        <ol className="flex items-center gap-1" aria-label="Jornada do cliente">
          {journey.steps.map((step, index) => {
            const isBlocker = step.key === blockerKey;
            return (
              <Fragment key={step.key}>
                <li title={`${step.label} — ${step.hint}`} className="flex min-w-0 items-center gap-1">
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
                      step.done
                        ? "bg-emerald-500 text-white"
                        : isBlocker
                          ? "bg-amber-500 text-white"
                          : cn("border text-muted-foreground", step.optional && "border-dashed"),
                    )}
                  >
                    {step.done ? <Check className="size-2.5" /> : isBlocker ? "!" : index + 1}
                  </span>
                  {isBlocker ? (
                    <span className="truncate text-[11px] font-medium text-amber-800 dark:text-amber-300">{step.label}</span>
                  ) : null}
                </li>
                {index < journey.steps.length - 1 ? (
                  <li aria-hidden className={cn("h-px w-4 shrink-0", step.done ? "bg-emerald-400" : "bg-border")} />
                ) : null}
              </Fragment>
            );
          })}
        </ol>
        {journey.blocker ? (
          <p className="flex items-start gap-1.5 text-xs text-amber-900 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-medium">Travado em “{journey.blocker.label}”</span> — {journey.blocker.hint}
              {days ? <span className="text-muted-foreground"> · {days}</span> : null}
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {STAGE_LABEL[journey.stage]}
            {days ? ` · ${days}` : ""}
            {journey.attentionReasons.length ? ` · ${journey.attentionReasons.join(" · ")}` : ""}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card px-3 py-3">
      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1" aria-label="Jornada do cliente">
        {journey.steps.map((step, index) => {
          const isBlocker = step.key === blockerKey;
          return (
            <Fragment key={step.key}>
              <li
                className={cn(
                  "flex min-w-[112px] flex-1 items-start gap-2 rounded-lg border px-2 py-1.5",
                  step.optional && "border-dashed",
                  step.done && "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20",
                  !step.done && !isBlocker && "bg-muted/30 text-muted-foreground",
                  isBlocker &&
                    "border-amber-400 bg-amber-50 ring-1 ring-amber-300/60 dark:border-amber-700 dark:bg-amber-950/40 dark:ring-amber-800/60",
                )}
                title={step.hint}
                aria-current={isBlocker ? "step" : undefined}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    step.done ? "bg-emerald-500 text-white" : isBlocker ? "bg-amber-500 text-white" : "border border-current",
                  )}
                >
                  {step.done ? <Check className="size-3" /> : isBlocker ? "!" : index + 1}
                </span>
                <span className="min-w-0 text-xs leading-tight">
                  <span className={cn("block font-medium", isBlocker && "text-amber-900 dark:text-amber-200")}>
                    {step.label}
                  </span>
                  {step.optional ? <span className="block text-[10px] text-muted-foreground">recomendado</span> : null}
                  {isBlocker ? <span className="block text-[10px] text-amber-800 dark:text-amber-300">travado aqui</span> : null}
                </span>
              </li>
              <li aria-hidden className="flex shrink-0 items-center text-muted-foreground/60">
                <ChevronRight className="size-3.5" />
              </li>
            </Fragment>
          );
        })}
        <li className="flex shrink-0 flex-col items-start justify-center gap-0.5 px-1">
          {journey.stage === "onboarding" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
              {STAGE_LABEL.rodando}
            </span>
          ) : (
            <StagePill stage={journey.stage} size="md" />
          )}
          <span className="text-[10px] text-muted-foreground">
            {journey.stage === "onboarding" ? "próxima etapa" : (days ?? "etapa atual")}
          </span>
        </li>
      </ol>
      {journey.blocker ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-medium">Travado em “{journey.blocker.label}”</span> — {journey.blocker.hint}
            {days ? <span className="text-muted-foreground"> · {days}</span> : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Tag de problema. As detectadas pelos dados levam o brilho. */
export function ProblemTagChip({
  tag,
  auto,
  className,
}: {
  tag: Pick<ProblemTag, "key" | "label">;
  auto: boolean;
  className?: string;
}) {
  return (
    <span
      title={auto ? "Detectado pelos dados" : "Marcado pela equipe"}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border border-amber-300/70 bg-amber-50 px-1.5 py-0.5 text-[11px] leading-tight text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200",
        className,
      )}
    >
      {auto ? <Sparkles className="size-3 shrink-0 opacity-70" aria-label="automática" /> : null}
      <span className="truncate">{tag.label}</span>
    </span>
  );
}

/** Risco de cobrança: aparece, mas apagado — é do Financeiro, não do gestor. */
export function FinanceChip({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground",
            className,
          )}
        >
          <Wallet className="size-3 shrink-0" />
          <span className="shrink-0 font-medium">Financeiro</span>
          <span className="truncate">· {text}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs">
        {text}. Quem cuida é o Financeiro — só para você saber antes de falar com o cliente.
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Ícone pequeno e apagado com dica: sinal secundário (sem passagem do Fred,
 * cobrança, "+2" problemas). Focável pelo teclado; o leitor de tela lê o
 * `label`. Fica acima do link "esticado" do cartão (`relative z-10`).
 */
export function HintIcon({
  label,
  tooltip,
  children,
  className,
  side = "top",
}: {
  label: string;
  tooltip?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span
          role="img"
          tabIndex={0}
          aria-label={label}
          className={cn(
            "relative z-10 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            className,
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-64 text-xs">
        {tooltip ?? label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Plano em texto pequeno e apagado; Premium leva um ponto violeta discreto. */
export function PlanText({ tier, className }: { tier: PlanTier; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground", className)}>
      {tier === "premium" ? <span className="size-1.5 rounded-full bg-violet-500" aria-hidden /> : null}
      {PLAN_LABEL[tier]}
    </span>
  );
}

/** Cor da frase do próximo passo: vermelho só no crítico, âmbar (texto) na atenção. */
export const NEXT_STEP_TONE: Record<"critical" | "attention" | "neutral", string> = {
  critical: "font-medium text-red-700 dark:text-red-400",
  attention: "text-amber-700 dark:text-amber-400",
  neutral: "text-foreground",
};

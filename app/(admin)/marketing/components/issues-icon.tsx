"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { EffectiveStatus } from "@/lib/meta-business/types";
import type {
  AdIssue,
  AdReviewFeedback,
  DescendantIssuesSummary,
  EffectiveStatus as EffectiveStatusType,
} from "@/lib/meta-business/types";

type Severity = "warning" | "error";
export type IssuesEntityType = "campaign" | "adset" | "ad";

type ReviewFeedbackEntry = {
  scope: string;
  reasons: Record<string, string>;
};

/**
 * Shared shape between Ad, AdSet and Campaign for the issues icon. Only `Ad`
 * has `reviewFeedback`; AdSet/Campaign always pass it as undefined.
 * `issuesSummary` is the roll-up of descendant problems — present on Campaign
 * and AdSet, undefined on Ad.
 */
export type IssuesIconEntity = {
  issues?: AdIssue[];
  reviewFeedback?: AdReviewFeedback;
  effectiveStatus?: EffectiveStatusType;
  issuesSummary?: DescendantIssuesSummary;
};

type IssuesIconProps = {
  entity: IssuesIconEntity;
  /**
   * What kind of entity this icon belongs to. Picks the right modal title
   * and decides whether to show the "descendants with issues" section.
   */
  entityType: IssuesEntityType;
};

// ─── pt-BR strings (hardcoded — backoffice doesn't use next-intl) ────────────

const MODAL_TITLE_WARNING: Record<IssuesEntityType, string> = {
  campaign: "Avisos da campanha",
  adset: "Avisos do conjunto",
  ad: "Avisos do anúncio",
};
const MODAL_TITLE_ERROR: Record<IssuesEntityType, string> = {
  campaign: "Problemas na campanha",
  adset: "Problemas no conjunto",
  ad: "Problemas no anúncio",
};
const LEVEL_LABEL = {
  AD: "Origem: anúncio",
  AD_SET: "Origem: conjunto de anúncios",
  CAMPAIGN: "Origem: campanha",
} as const;
const DESCENDANT_HINT: Record<"campaign" | "adset", string> = {
  campaign: "Abra a campanha e verifique os conjuntos e anúncios para detalhes.",
  adset: "Abra o conjunto e verifique os anúncios para detalhes.",
};

function pluralAdSets(count: number): string {
  return count === 1
    ? "1 conjunto de anúncios com problemas"
    : `${count} conjuntos de anúncios com problemas`;
}
function pluralAds(count: number): string {
  return count === 1
    ? "1 anúncio com problemas"
    : `${count} anúncios com problemas`;
}
function pluralBlocking(count: number): string {
  return count === 1
    ? "1 está bloqueado pela Meta"
    : `${count} estão bloqueados pela Meta`;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function descendantHasAny(
  summary: DescendantIssuesSummary | undefined,
): boolean {
  if (!summary) return false;
  const a = summary.adSets;
  const b = summary.ads;
  if (a && (a.withIssues > 0 || a.disapproved > 0)) return true;
  if (b && (b.withIssues > 0 || b.disapproved > 0)) return true;
  return false;
}

function descendantHasDisapproved(
  summary: DescendantIssuesSummary | undefined,
): boolean {
  if (!summary) return false;
  if (summary.adSets && summary.adSets.disapproved > 0) return true;
  if (summary.ads && summary.ads.disapproved > 0) return true;
  return false;
}

export function hasIssues(entity: IssuesIconEntity): boolean {
  if (entity.issues && entity.issues.length > 0) return true;
  if (entity.reviewFeedback) {
    if (
      entity.reviewFeedback.global &&
      Object.keys(entity.reviewFeedback.global).length > 0
    ) {
      return true;
    }
    if (
      entity.reviewFeedback.placementSpecific &&
      Object.keys(entity.reviewFeedback.placementSpecific).length > 0
    ) {
      return true;
    }
  }
  if (
    entity.effectiveStatus === EffectiveStatus.DISAPPROVED ||
    entity.effectiveStatus === EffectiveStatus.WITH_ISSUES
  ) {
    return true;
  }
  if (descendantHasAny(entity.issuesSummary)) return true;
  return false;
}

function computeSeverity(entity: IssuesIconEntity): Severity {
  if (entity.effectiveStatus === EffectiveStatus.DISAPPROVED) return "error";
  if (entity.issues?.some((i) => i.errorType === "HARD_ERROR")) return "error";
  if (
    entity.reviewFeedback?.global &&
    Object.keys(entity.reviewFeedback.global).length > 0
  ) {
    return "error";
  }
  if (descendantHasDisapproved(entity.issuesSummary)) return "error";
  return "warning";
}

function flattenReviewFeedback(
  feedback: AdReviewFeedback | undefined,
): ReviewFeedbackEntry[] {
  if (!feedback) return [];
  const entries: ReviewFeedbackEntry[] = [];
  if (feedback.global && Object.keys(feedback.global).length > 0) {
    entries.push({ scope: "global", reasons: feedback.global });
  }
  if (feedback.placementSpecific) {
    for (const [scope, reasons] of Object.entries(feedback.placementSpecific)) {
      if (reasons && Object.keys(reasons).length > 0) {
        entries.push({ scope, reasons });
      }
    }
  }
  return entries;
}

// ─── content (shared between tooltip and dialog) ─────────────────────────────

function IssuesContent({ entity, entityType }: IssuesIconProps) {
  const reviewEntries = flattenReviewFeedback(entity.reviewFeedback);
  const issues = entity.issues ?? [];
  const summary = entity.issuesSummary;
  const adSetsCount = summary?.adSets
    ? summary.adSets.withIssues + summary.adSets.disapproved
    : 0;
  const adsCount = summary?.ads
    ? summary.ads.withIssues + summary.ads.disapproved
    : 0;
  const hasDescendantSection = adSetsCount > 0 || adsCount > 0;

  return (
    <div className="space-y-4 text-sm">
      {issues.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Avisos de veiculação
          </h4>
          <ul className="space-y-2">
            {issues.map((issue, idx) => {
              const isHard = issue.errorType === "HARD_ERROR";
              return (
                <li
                  key={`${issue.errorCode ?? "issue"}-${idx}`}
                  className={cn(
                    "rounded-md border p-3",
                    isHard
                      ? "border-destructive/40 bg-destructive/10"
                      : "border-amber-500/40 bg-amber-500/10",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="font-medium leading-tight">
                      {issue.errorSummary ?? "Aviso da Meta"}
                    </p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                        isHard
                          ? "bg-destructive/20 text-destructive dark:text-red-300"
                          : "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {isHard ? "Bloqueante" : "Aviso"}
                    </span>
                  </div>
                  {issue.errorMessage && (
                    <p className="text-xs text-muted-foreground">
                      {issue.errorMessage}
                    </p>
                  )}
                  {issue.level && (
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {LEVEL_LABEL[issue.level]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {reviewEntries.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Reprovações de análise
          </h4>
          <ul className="space-y-2">
            {reviewEntries.flatMap((entry) =>
              Object.entries(entry.reasons).map(([key, reason]) => (
                <li
                  key={`${entry.scope}-${key}`}
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-3"
                >
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-destructive dark:text-red-300">
                    {entry.scope === "global"
                      ? "Em todas as plataformas"
                      : entry.scope}
                  </p>
                  <p className="text-xs text-muted-foreground">{reason}</p>
                </li>
              )),
            )}
          </ul>
        </section>
      )}

      {hasDescendantSection && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Em níveis abaixo
          </h4>
          <ul className="space-y-2">
            {adSetsCount > 0 && summary?.adSets && (
              <li
                className={cn(
                  "rounded-md border p-3",
                  summary.adSets.disapproved > 0
                    ? "border-destructive/40 bg-destructive/10"
                    : "border-amber-500/40 bg-amber-500/10",
                )}
              >
                <p className="font-medium leading-tight">
                  {pluralAdSets(adSetsCount)}
                </p>
                {summary.adSets.disapproved > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {pluralBlocking(summary.adSets.disapproved)}
                  </p>
                )}
              </li>
            )}
            {adsCount > 0 && summary?.ads && (
              <li
                className={cn(
                  "rounded-md border p-3",
                  summary.ads.disapproved > 0
                    ? "border-destructive/40 bg-destructive/10"
                    : "border-amber-500/40 bg-amber-500/10",
                )}
              >
                <p className="font-medium leading-tight">
                  {pluralAds(adsCount)}
                </p>
                {summary.ads.disapproved > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {pluralBlocking(summary.ads.disapproved)}
                  </p>
                )}
              </li>
            )}
          </ul>
          {entityType !== "ad" && (
            <p className="text-xs text-muted-foreground">
              {DESCENDANT_HINT[entityType]}
            </p>
          )}
        </section>
      )}

      {issues.length === 0 &&
        reviewEntries.length === 0 &&
        !hasDescendantSection && (
          <p className="text-xs text-muted-foreground">
            Sem detalhes adicionais disponíveis.
          </p>
        )}
    </div>
  );
}

// ─── main component ─────────────────────────────────────────────────────────

export function IssuesIcon({ entity, entityType }: IssuesIconProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const severity = useMemo(() => computeSeverity(entity), [entity]);
  if (!hasIssues(entity)) return null;

  const title =
    severity === "error"
      ? MODAL_TITLE_ERROR[entityType]
      : MODAL_TITLE_WARNING[entityType];

  const colorClass =
    severity === "error"
      ? "text-destructive dark:text-red-400"
      : "text-amber-600 dark:text-amber-400";

  const issueCount =
    (entity.issues?.length ?? 0) +
    flattenReviewFeedback(entity.reviewFeedback).reduce(
      (sum, e) => sum + Object.keys(e.reasons).length,
      0,
    );

  const ariaLabel =
    severity === "error"
      ? `${issueCount} problema(s) bloqueante(s) de veiculação`
      : `${issueCount} aviso(s) de veiculação`;

  const buttonClasses = cn(
    "inline-flex size-7 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    colorClass,
  );

  const trigger = (
    <button
      type="button"
      onClick={(e) => {
        // Stop the parent row from receiving the click (tables open detail
        // sheets on row click).
        e.stopPropagation();
        if (isMobile) setOpen(true);
      }}
      aria-label={ariaLabel}
      className={buttonClasses}
    >
      <AlertTriangle className="size-4" aria-hidden="true" />
    </button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <IssuesContent entity={entity} entityType={entityType} />
            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Fechar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent
          side="left"
          align="center"
          className="max-w-sm border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <IssuesContent entity={entity} entityType={entityType} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

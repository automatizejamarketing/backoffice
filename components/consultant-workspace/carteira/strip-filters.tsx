"use client";

import { ChevronDown, Tag, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PROBLEM_TAGS, STAGE_DESCRIPTION, type JourneyStage } from "@/lib/consultant-workspace/journey";
import { STAGE_DOT, STAGE_SHORT } from "@/components/consultant-workspace/common/journey-bits";

const STAGES: JourneyStage[] = ["onboarding", "rodando", "parado"];

/** Etapa da jornada como filtro de primeira classe: em que ponto do processo cada cliente está. */
export function StageChips({
  counts,
  stage,
  onStage,
}: {
  counts: Record<JourneyStage, number>;
  stage: JourneyStage | null;
  onStage: (stage: JourneyStage | null) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Etapa da jornada">
      <span className="mr-0.5 text-xs text-muted-foreground">Etapa</span>
      {STAGES.map((value) => {
        const active = stage === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            title={STAGE_DESCRIPTION[value]}
            onClick={() => onStage(active ? null : value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs whitespace-nowrap transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", STAGE_DOT[value])} />
            {STAGE_SHORT[value]}
            <span className={cn("tabular-nums", active ? "opacity-80" : "text-foreground")}>{counts[value]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TagFilter({
  counts,
  tag,
  onTag,
}: {
  counts: Record<string, number>;
  tag: string | null;
  onTag: (tag: string | null) => void;
}) {
  const active = tag ? PROBLEM_TAGS.find((entry) => entry.key === tag) : null;
  const withCount = PROBLEM_TAGS.filter((entry) => (counts[entry.key] ?? 0) > 0 || entry.key === tag);
  return (
    <div className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-md border px-2 text-xs whitespace-nowrap",
            active
              ? "rounded-r-none border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Tag className="size-3.5 shrink-0" />
          <span className="truncate">{active ? active.label : "Problema"}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Tags de problema (detectadas ou marcadas) — cada uma tem playbook
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {withCount.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma tag nesta seleção.</p>
          ) : (
            withCount.map((entry) => (
              <DropdownMenuCheckboxItem
                key={entry.key}
                checked={tag === entry.key}
                onCheckedChange={() => onTag(tag === entry.key ? null : entry.key)}
                className="text-xs"
              >
                <span className="flex-1 truncate">{entry.label}</span>
                <span className="ml-2 tabular-nums text-muted-foreground">{counts[entry.key] ?? 0}</span>
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {active ? (
        <button
          type="button"
          onClick={() => onTag(null)}
          aria-label="Limpar filtro de problema"
          className="flex h-7 items-center rounded-r-md border border-l-0 border-amber-400 bg-amber-50 px-1.5 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

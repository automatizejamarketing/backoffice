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
import { NO_HANDOFF_LABEL, NO_HANDOFF_TAG } from "./filters";

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

const PROBLEM_OPTIONS: Array<{ key: string; label: string }> = [
  ...PROBLEM_TAGS.map((entry) => ({ key: entry.key, label: entry.label })),
  { key: NO_HANDOFF_TAG, label: NO_HANDOFF_LABEL },
];

/**
 * Filtro "Problema": uma lista com a contagem de cada opção (tags de problema
 * e "Sem passagem do Fred"). Sem cor — o filtro ativo só fica marcado.
 */
export function TagFilter({
  counts,
  tag,
  onTag,
}: {
  counts: Record<string, number>;
  tag: string | null;
  onTag: (tag: string | null) => void;
}) {
  const active = tag ? (PROBLEM_OPTIONS.find((entry) => entry.key === tag) ?? null) : null;
  const visible = PROBLEM_OPTIONS.filter((entry) => (counts[entry.key] ?? 0) > 0 || entry.key === tag);
  const problems = visible
    .filter((entry) => entry.key !== NO_HANDOFF_TAG)
    .sort((a, b) => (counts[b.key] ?? 0) - (counts[a.key] ?? 0));
  const handoff = visible.find((entry) => entry.key === NO_HANDOFF_TAG) ?? null;
  const item = (entry: { key: string; label: string }) => (
    <DropdownMenuCheckboxItem
      key={entry.key}
      checked={tag === entry.key}
      onCheckedChange={() => onTag(tag === entry.key ? null : entry.key)}
      className="text-xs"
    >
      <span className="flex-1 truncate">{entry.label}</span>
      <span className="ml-2 tabular-nums text-muted-foreground">{counts[entry.key] ?? 0}</span>
    </DropdownMenuCheckboxItem>
  );
  return (
    <div className="flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={active ? `Problema: ${active.label}` : "Filtrar por problema"}
          className={cn(
            "inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md border px-2 text-xs whitespace-nowrap",
            active
              ? "rounded-r-none border-foreground/30 bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Tag className="size-3.5 shrink-0" />
          <span className="truncate">{active ? active.label : "Problema"}</span>
          {active ? (
            <span className="tabular-nums text-muted-foreground">{counts[active.key] ?? 0}</span>
          ) : null}
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Problemas (detectados ou marcados) — cada um tem playbook
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {problems.length === 0 && !handoff ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum problema nesta seleção.</p>
          ) : (
            problems.map(item)
          )}
          {handoff ? (
            <>
              {problems.length > 0 ? <DropdownMenuSeparator /> : null}
              {item(handoff)}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {active ? (
        <button
          type="button"
          onClick={() => onTag(null)}
          aria-label="Limpar filtro de problema"
          className="flex h-7 items-center rounded-r-md border border-l-0 border-foreground/30 bg-muted px-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

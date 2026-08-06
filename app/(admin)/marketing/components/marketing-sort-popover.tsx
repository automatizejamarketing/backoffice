"use client";

import { ArrowUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SortOrder } from "@/lib/meta-business/campaign-sort";
import {
  findActiveSortPreset,
  MARKETING_QUICK_SORT_PRESETS,
} from "../utils/marketing-sort-options";
import type { CampaignMetricId } from "../utils/campaign-metrics";

type MarketingSortPopoverProps = {
  sortMetric: CampaignMetricId | null;
  sortOrder: SortOrder;
  onSortMetricChange: (metric: CampaignMetricId | null) => void;
  onSortOrderChange: (order: SortOrder) => void;
  /** Mantido por compatibilidade; presets já priorizam métricas de venda. */
  emphasizeSales?: boolean;
  className?: string;
};

export function MarketingSortPopover({
  sortMetric,
  sortOrder,
  onSortMetricChange,
  onSortOrderChange,
  className,
}: MarketingSortPopoverProps) {
  const activePreset = findActiveSortPreset(sortMetric, sortOrder);

  const handlePresetSelect = (preset: (typeof MARKETING_QUICK_SORT_PRESETS)[number]) => {
    onSortMetricChange(preset.metric);
    onSortOrderChange(preset.order);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn("size-7 shrink-0 text-muted-foreground", className)}
          aria-label={activePreset ? `Ordenar: ${activePreset.label}` : "Ordenar lista"}
          title={activePreset?.label ?? "Ordenar lista"}
        >
          <ArrowUpDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,15rem)] p-1.5">
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          Ordenar por
        </p>
        <div className="space-y-0.5">
          {MARKETING_QUICK_SORT_PRESETS.map((preset) => {
            const isSelected = activePreset?.id === preset.id;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handlePresetSelect(preset)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-accent",
                  isSelected && "bg-accent font-medium text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-border",
                    isSelected && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {isSelected ? <Check className="size-2.5" /> : null}
                </span>
                <span className="leading-snug">{preset.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

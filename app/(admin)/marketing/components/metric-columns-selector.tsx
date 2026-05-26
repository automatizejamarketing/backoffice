"use client";

import { Check, ChevronsUpDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type {
  CampaignMetricDefinition,
  CampaignMetricId,
} from "../utils/campaign-metrics";

type MetricColumnsSelectorProps = {
  selectedMetricIds: CampaignMetricId[] | null;
  onChange: (metricIds: CampaignMetricId[] | null) => void;
  options: CampaignMetricDefinition[];
  getLabel: (labelKey: string) => string;
  minSelected?: number;
};

export function MetricColumnsSelector({
  selectedMetricIds,
  onChange,
  options,
  getLabel,
  minSelected = 1,
}: MetricColumnsSelectorProps) {
  const customMetricIds = selectedMetricIds ?? [];
  const selectedIds = new Set(customMetricIds);
  const isCustom = selectedMetricIds !== null;

  const handleToggle = (metricId: CampaignMetricId) => {
    if (!isCustom) {
      onChange([metricId]);
      return;
    }

    if (selectedIds.has(metricId)) {
      if (customMetricIds.length <= minSelected) return;
      onChange(customMetricIds.filter((id) => id !== metricId));
      return;
    }

    onChange([...customMetricIds, metricId]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-2 text-xs"
          aria-label="Configurar métricas da tabela"
        >
          <SlidersHorizontal className="size-3.5" />
          <span className="hidden sm:inline">
            {isCustom ? `Métricas (${customMetricIds.length})` : "Métricas: padrão"}
          </span>
          <span className="sm:hidden">Métricas</span>
          <ChevronsUpDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,22rem)] p-0">
        <Command>
          <div className="border-b border-border/60 px-3 py-2">
            <p className="text-sm font-medium">Colunas de métricas</p>
            <p className="text-xs text-muted-foreground">
              Escolha as métricas exibidas em campanhas, conjuntos e anúncios.
            </p>
          </div>
          <CommandInput placeholder="Buscar métrica..." />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhuma métrica encontrada.</CommandEmpty>
            <CommandGroup>
              {options.map((metric) => {
                const checked = isCustom && selectedIds.has(metric.id);
                const disabled = checked && customMetricIds.length <= minSelected;

                return (
                  <CommandItem
                    key={metric.id}
                    value={`${metric.id} ${getLabel(metric.labelKey)}`}
                    onSelect={() => handleToggle(metric.id)}
                    disabled={disabled}
                    className="flex items-center gap-2"
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-sm border border-border",
                        checked && "bg-primary text-primary-foreground",
                      )}
                    >
                      {checked ? <Check className="size-3" /> : null}
                    </span>
                    <span className="flex-1 truncate">{getLabel(metric.labelKey)}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between gap-2 border-t border-border/60 p-2">
            <Badge variant={isCustom ? "default" : "secondary"} className="text-[10px]">
              {isCustom ? `${customMetricIds.length} selecionada(s)` : "Padrão por objetivo"}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => onChange(null)}
              disabled={!isCustom}
            >
              <RotateCcw className="size-3" />
              Restaurar padrão
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

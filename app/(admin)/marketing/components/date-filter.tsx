"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import { DatePreset } from "@/lib/meta-business/types";

type DateFilterProps = {
  datePreset?: DatePreset | null;
  onDatePresetChange?: (preset: DatePreset | null) => void;
  customRange?: { since: string; until: string } | null;
  onCustomRangeChange?: (range: { since: string; until: string } | null) => void;
};

const PRESET_LABELS: Record<DatePreset, string> = {
  [DatePreset.TODAY]: "Hoje",
  [DatePreset.YESTERDAY]: "Ontem",
  [DatePreset.THIS_MONTH]: "Este mês",
  [DatePreset.LAST_MONTH]: "Mês passado",
  [DatePreset.THIS_QUARTER]: "Este trimestre",
  [DatePreset.MAXIMUM]: "Máximo",
  [DatePreset.DATA_MAXIMUM]: "Máximo de dados",
  [DatePreset.LAST_3D]: "Últimos 3 dias",
  [DatePreset.LAST_7D]: "Últimos 7 dias",
  [DatePreset.LAST_14D]: "Últimos 14 dias",
  [DatePreset.LAST_28D]: "Últimos 28 dias",
  [DatePreset.LAST_30D]: "Últimos 30 dias",
  [DatePreset.LAST_90D]: "Últimos 90 dias",
  [DatePreset.LAST_WEEK_MON_SUN]: "Semana passada (Seg-Dom)",
  [DatePreset.LAST_WEEK_SUN_SAT]: "Semana passada (Dom-Sáb)",
  [DatePreset.LAST_QUARTER]: "Trimestre passado",
  [DatePreset.LAST_YEAR]: "Ano passado",
  [DatePreset.THIS_WEEK_MON_TODAY]: "Esta semana (Seg-Hoje)",
  [DatePreset.THIS_WEEK_SUN_TODAY]: "Esta semana (Dom-Hoje)",
  [DatePreset.THIS_YEAR]: "Este ano",
};

export function DateFilter({
  datePreset = DatePreset.LAST_30D,
  onDatePresetChange,
  customRange,
}: DateFilterProps) {
  const displayValue = customRange
    ? "Período personalizado"
    : datePreset
      ? PRESET_LABELS[datePreset]
      : "Selecione um período";

  return (
    <Select
      value={customRange ? "custom" : datePreset || ""}
      onValueChange={(value) => {
        if (value === "custom") {
          // For custom, we'd need a calendar component
          // For now, just keep the current preset
          return;
        }
        onDatePresetChange?.(value as DatePreset);
      }}
    >
      <SelectTrigger className="w-[180px] sm:w-[200px]">
        <CalendarIcon className="size-4 mr-2 text-muted-foreground" />
        <SelectValue>{displayValue}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.values(DatePreset).map((preset) => (
          <SelectItem key={preset} value={preset}>
            {PRESET_LABELS[preset]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

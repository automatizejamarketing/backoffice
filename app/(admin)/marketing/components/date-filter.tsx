"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { DateRangeDialog } from "@/components/date-range-dialog";
import { DatePreset } from "@/lib/meta-business/types";

export type DateFilterRange = {
  datePreset: DatePreset | null;
  customRange: { since: string; until: string } | null;
};

export function resolveDateFilterFromParent(
  parentDatePreset?: DatePreset | null,
  parentCustomRange?: { since: string; until: string } | null,
): DateFilterRange {
  if (parentCustomRange?.since && parentCustomRange?.until) {
    return { datePreset: null, customRange: parentCustomRange };
  }

  if (parentDatePreset) {
    return { datePreset: parentDatePreset, customRange: null };
  }

  return { datePreset: DatePreset.LAST_30D, customRange: null };
}

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

const DATE_FILTER_PRESETS: DatePreset[] = [
  DatePreset.TODAY,
  DatePreset.YESTERDAY,
  DatePreset.LAST_7D,
  DatePreset.LAST_14D,
  DatePreset.LAST_30D,
];

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function DateFilter({
  datePreset = DatePreset.LAST_30D,
  onDatePresetChange,
  customRange,
  onCustomRangeChange,
}: DateFilterProps) {
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  const handlePresetChange = (value: string) => {
    if (value === "custom") {
      setIsCustomOpen(true);
      return;
    }

    onCustomRangeChange?.(null);
    onDatePresetChange?.(value as DatePreset);
  };

  const displayValue = customRange
    ? `${formatDisplayDate(customRange.since)} - ${formatDisplayDate(customRange.until)}`
    : datePreset
      ? PRESET_LABELS[datePreset]
      : "Selecione um período";

  return (
    <div className="flex items-center gap-2">
      <Select
        value={customRange ? "custom" : datePreset || ""}
        onValueChange={handlePresetChange}
      >
        <SelectTrigger className="w-[180px] sm:w-[220px]">
          <CalendarIcon className="size-4 mr-2 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">
            {displayValue}
          </span>
        </SelectTrigger>
        <SelectContent>
          {DATE_FILTER_PRESETS.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {PRESET_LABELS[preset]}
            </SelectItem>
          ))}
          <SelectItem value="custom">
            <span className="flex items-center gap-2">
              Período personalizado
              <ChevronDown className="size-3" />
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      <DateRangeDialog
        open={isCustomOpen}
        onOpenChange={setIsCustomOpen}
        initialRange={
          customRange
            ? {
                from: parseLocalDate(customRange.since),
                to: parseLocalDate(customRange.until),
              }
            : undefined
        }
        onApply={(range) => {
          onCustomRangeChange?.({
            since: formatLocalDate(range.from),
            until: formatLocalDate(range.to),
          });
        }}
        disabledAfter={new Date()}
      />
    </div>
  );
}

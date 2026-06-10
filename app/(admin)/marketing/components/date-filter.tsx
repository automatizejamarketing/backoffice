"use client";

import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { CalendarIcon, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";
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
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    customRange
      ? {
          from: parseLocalDate(customRange.since),
          to: parseLocalDate(customRange.until),
        }
      : undefined,
  );

  const handlePresetChange = (value: string) => {
    if (value === "custom") {
      if (customRange) {
        setDateRange({
          from: parseLocalDate(customRange.since),
          to: parseLocalDate(customRange.until),
        });
      }
      setIsCustomOpen(true);
      return;
    }

    onCustomRangeChange?.(null);
    onDatePresetChange?.(value as DatePreset);
  };

  const handleCustomRangeApply = () => {
    if (!dateRange?.from || !dateRange?.to) return;

    const since = formatLocalDate(dateRange.from);
    const until = formatLocalDate(dateRange.to);
    onCustomRangeChange?.({ since, until });
    setIsCustomOpen(false);
  };

  const handleCustomRangeCancel = () => {
    setIsCustomOpen(false);
    setDateRange(
      customRange
        ? {
            from: parseLocalDate(customRange.since),
            to: parseLocalDate(customRange.until),
          }
        : undefined,
    );
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

      <Dialog
        open={isCustomOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsCustomOpen(true);
          } else {
            handleCustomRangeCancel();
          }
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] w-fit max-w-[calc(100vw-2rem)] overflow-y-auto p-0">
          <div className="flex max-h-[calc(100vh-2rem)] flex-col">
            <DialogHeader className="border-b px-6 py-4">
              <DialogTitle>Selecionar período personalizado</DialogTitle>
              <DialogDescription>
                Escolha a data inicial e final para filtrar os resultados.
              </DialogDescription>
            </DialogHeader>

            <div className="overflow-x-auto px-4 py-4">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                disabled={{ after: new Date() }}
              />
            </div>

            <DialogFooter className="border-t px-6 py-4">
              <Button variant="outline" onClick={handleCustomRangeCancel}>
                Cancelar
              </Button>
              <Button
                onClick={handleCustomRangeApply}
                disabled={!dateRange?.from || !dateRange?.to}
              >
                Aplicar
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

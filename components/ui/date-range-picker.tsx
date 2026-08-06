"use client";

import { useMemo, useState, type ComponentProps } from "react";
import {
  format,
  isSameDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { resolveDateRangeSelection } from "@/lib/backoffice/date-range-selection";
import { cn } from "@/lib/utils";

type DateRangePickerProps = {
  date?: DateRange;
  onDateChange: (date: DateRange) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  disabledAfter?: Date;
  active?: boolean;
  triggerVariant?: ComponentProps<typeof Button>["variant"];
};

type DatePreset = {
  label: string;
  range: DateRange;
};

export function DateRangePicker({
  date,
  onDateChange,
  placeholder = "Selecionar período",
  className,
  disabled = false,
  disabledAfter = new Date(),
  active = false,
  triggerVariant = "outline",
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(date);

  const presets = useMemo<DatePreset[]>(() => {
    const today = disabledAfter;

    return [
      {
        label: "Este mês",
        range: { from: startOfMonth(today), to: today },
      },
      {
        label: "Últimos 30 dias",
        range: { from: subDays(today, 29), to: today },
      },
      {
        label: "Últimos 3 meses",
        range: { from: subMonths(today, 3), to: today },
      },
      {
        label: "Últimos 6 meses",
        range: { from: subMonths(today, 6), to: today },
      },
      {
        label: "Últimos 12 meses",
        range: { from: subMonths(today, 12), to: today },
      },
      {
        label: "Mês passado",
        range: {
          from: startOfMonth(subMonths(today, 1)),
          to: new Date(today.getFullYear(), today.getMonth(), 0, 12),
        },
      },
    ];
  }, [disabledAfter]);

  const selectedRange = isOpen ? draftRange : date;

  function applyRange(range: DateRange) {
    setDraftRange(range);
    onDateChange(range);
    setIsOpen(false);
  }

  function formatDateRange(range: DateRange | undefined) {
    if (!range?.from) return placeholder;
    if (!range.to) return format(range.from, "dd/MM/yy");
    return `${format(range.from, "dd/MM/yy")} – ${format(range.to, "dd/MM/yy")}`;
  }

  function isSelectedPreset(preset: DatePreset) {
    return Boolean(
      draftRange?.from &&
        draftRange.to &&
        preset.range.from &&
        preset.range.to &&
        isSameDay(draftRange.from, preset.range.from) &&
        isSameDay(draftRange.to, preset.range.to),
    );
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDraftRange(date);
        setIsOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={triggerVariant}
          className={cn(
            "justify-start gap-1.5 text-left font-normal",
            !selectedRange?.from && "text-muted-foreground",
            className,
          )}
          disabled={disabled}
          aria-pressed={active}
        >
          <CalendarIcon className="size-3.5" aria-hidden="true" />
          <span className="truncate">{formatDateRange(selectedRange)}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="max-h-[calc(100vh-2rem)] w-auto max-w-[calc(100vw-2rem)] overflow-auto p-0"
        align="start"
      >
        <div className="flex flex-col sm:flex-row">
          <div className="grid grid-cols-2 content-start gap-1 border-b p-2 sm:w-40 sm:grid-cols-1 sm:border-r sm:border-b-0">
            {presets.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant={isSelectedPreset(preset) ? "secondary" : "ghost"}
                size="sm"
                className="h-8 justify-start px-2 text-xs font-normal"
                aria-pressed={isSelectedPreset(preset)}
                onClick={() => applyRange(preset.range)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <Calendar
            mode="range"
            selected={draftRange}
            defaultMonth={draftRange?.from}
            onSelect={(nextRange) => {
              const selection = resolveDateRangeSelection(
                draftRange,
                nextRange,
              );

              setDraftRange(selection.draftRange);

              if (selection.isComplete && selection.draftRange) {
                applyRange(selection.draftRange);
              }
            }}
            disabled={{ after: disabledAfter }}
            locale={ptBR}
            className="mx-auto bg-background p-2"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

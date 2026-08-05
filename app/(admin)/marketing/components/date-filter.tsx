"use client";

import { useMemo } from "react";
import { subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
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

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolvePresetRange(preset: DatePreset | null, today: Date): DateRange {
  switch (preset) {
    case DatePreset.TODAY:
      return { from: today, to: today };
    case DatePreset.YESTERDAY: {
      const yesterday = subDays(today, 1);
      return { from: yesterday, to: yesterday };
    }
    case DatePreset.LAST_3D:
      return { from: subDays(today, 2), to: today };
    case DatePreset.LAST_7D:
      return { from: subDays(today, 6), to: today };
    case DatePreset.LAST_14D:
      return { from: subDays(today, 13), to: today };
    case DatePreset.LAST_28D:
      return { from: subDays(today, 27), to: today };
    case DatePreset.LAST_90D:
      return { from: subDays(today, 89), to: today };
    case DatePreset.LAST_30D:
    default:
      return { from: subDays(today, 29), to: today };
  }
}

export function DateFilter({
  datePreset = DatePreset.LAST_30D,
  onDatePresetChange,
  customRange,
  onCustomRangeChange,
}: DateFilterProps) {
  const today = useMemo(() => {
    const value = new Date();
    value.setHours(12, 0, 0, 0);
    return value;
  }, []);

  const selectedRange = customRange
    ? {
        from: parseLocalDate(customRange.since),
        to: parseLocalDate(customRange.until),
      }
    : resolvePresetRange(datePreset, today);

  return (
    <DateRangePicker
      date={selectedRange}
      disabledAfter={today}
      placeholder="Selecionar período"
      className="h-9 w-full px-3 text-xs shadow-none sm:w-[220px]"
      onDateChange={({ from, to }) => {
        if (!from || !to) return;

        onDatePresetChange?.(null);
        onCustomRangeChange?.({
          since: formatLocalDate(from),
          until: formatLocalDate(to),
        });
      }}
    />
  );
}

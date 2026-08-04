import type { DateRange } from "react-day-picker";

export function resolveDateRangeSelection(
  currentRange: DateRange | undefined,
  nextRange: DateRange | undefined,
): {
  draftRange: DateRange | undefined;
  isComplete: boolean;
} {
  const isStartingNewRange =
    !currentRange?.from || Boolean(currentRange.to);

  if (isStartingNewRange && nextRange?.from) {
    return {
      draftRange: { from: nextRange.from, to: undefined },
      isComplete: false,
    };
  }

  return {
    draftRange: nextRange,
    isComplete: Boolean(nextRange?.from && nextRange.to),
  };
}

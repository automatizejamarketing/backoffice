"use client";

import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
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

export type DateRangeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Range to seed the calendar with each time the dialog opens. */
  initialRange?: DateRange;
  /** Fired only when the user confirms a complete from–to range. */
  onApply: (range: { from: Date; to: Date }) => void;
  title?: string;
  description?: string;
  numberOfMonths?: number;
  /** Dates strictly after this are not selectable (e.g. the future). */
  disabledAfter?: Date;
};

/**
 * Domain-neutral custom date-range picker: a two-month range Calendar inside a
 * Dialog with Cancelar/Aplicar. Owns only its draft selection; the applied
 * value lives in the parent. Shared by the marketing insights date filter and
 * the users signup-date filter so the picker exists in exactly one place.
 */
export function DateRangeDialog({
  open,
  onOpenChange,
  initialRange,
  onApply,
  title = "Selecionar período personalizado",
  description = "Escolha a data inicial e final para filtrar os resultados.",
  numberOfMonths = 2,
  disabledAfter,
}: DateRangeDialogProps) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    initialRange,
  );

  // Reseed the draft from the applied range whenever the dialog (re)opens, so
  // cancelling and reopening starts from the last confirmed range rather than a
  // stale in-progress selection. Intentionally keyed on `open` only.
  useEffect(() => {
    if (open) {
      setDateRange(initialRange);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleApply = () => {
    if (!dateRange?.from || !dateRange?.to) return;
    onApply({ from: dateRange.from, to: dateRange.to });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] w-fit max-w-[calc(100vw-2rem)] overflow-y-auto p-0">
        <div className="flex max-h-[calc(100vh-2rem)] flex-col">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="overflow-x-auto px-4 py-4">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={numberOfMonths}
              disabled={disabledAfter ? { after: disabledAfter } : undefined}
            />
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleApply}
              disabled={!dateRange?.from || !dateRange?.to}
            >
              Aplicar
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

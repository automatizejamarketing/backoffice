"use client";
import { useId, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  dateKey,
  parseDate,
  formatDate,
  isDateAllowed,
  validateDateRange,
  getDatePresets,
  type DateRange,
  type DatePreset,
} from "@/lib/dates";
import { cn } from "@/lib/utils";
export type { DateRange, DatePreset } from "@/lib/dates";

export type DateRangePickerProps = {
  value?: DateRange;
  onChange: (range: DateRange | undefined) => void;
  label?: string;
  minDate?: Date;
  maxDate?: Date;
  disabled?: boolean;
  /** Custom shortcuts; [] hides them. Dates are inclusive. */
  presets?: DatePreset[];
  className?: string;
};
export function DateRangePicker({
  value,
  onChange,
  label = "Período",
  minDate,
  maxDate,
  disabled,
  presets,
  className,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [month, setMonth] = useState(new Date());
  const id = useId();
  const error = validateDateRange(from, to, minDate, maxDate);
  const options = presets ?? getDatePresets();
  const display = value
    ? `${formatDate(value.from)} – ${formatDate(value.to)}`
    : "Selecionar período";
  function setDraft(range?: DateRange) {
    setFrom(range ? dateKey(range.from) : "");
    setTo(range ? dateKey(range.to) : "");
    if (range) setMonth(range.from);
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(value);
          setMonth(value?.from ?? minDate ?? new Date());
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={`${label}: ${display}`}
          className={cn("w-80 max-w-full justify-start", className)}
        >
          <CalendarIcon />
          <span className="truncate">{display}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={label}
        collisionPadding={8}
        className="flex w-auto max-w-[calc(100vw-16px)] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden p-2"
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto sm:flex-row">
          {options.length > 0 && (
            <div
              aria-label="Atalhos de período"
              className="flex shrink-0 w-[280px] max-w-full gap-1 overflow-x-auto sm:w-36 sm:flex-col sm:border-r sm:pr-2 [@media(pointer:coarse)]:w-[308px] sm:[@media(pointer:coarse)]:w-36"
            >
              {options.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="shrink-0 justify-start"
                  aria-pressed={
                    from === dateKey(preset.range.from) &&
                    to === dateKey(preset.range.to)
                  }
                  disabled={
                    !!validateDateRange(
                      dateKey(preset.range.from),
                      dateKey(preset.range.to),
                      minDate,
                      maxDate,
                    )
                  }
                  onClick={() => setDraft(preset.range)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          )}
          <div className="flex min-w-0 shrink-0 flex-col gap-2">
            <p className="px-1 text-sm font-semibold">{label}</p>
            <div className="grid grid-cols-2 gap-2 w-[280px] max-w-full [@media(pointer:coarse)]:w-[308px]">
              <Field>
                <FieldLabel htmlFor={`${id}-from`}>Início</FieldLabel>
                <Input
                  id={`${id}-from`}
                  className="min-w-0 px-2"
                  type="date"
                  value={from}
                  min={minDate && dateKey(minDate)}
                  max={maxDate && dateKey(maxDate)}
                  aria-describedby={`${id}-status`}
                  aria-invalid={!!from && !!to && !!error}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    const date = parseDate(e.target.value);
                    if (date) setMonth(date);
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-to`}>Fim</FieldLabel>
                <Input
                  id={`${id}-to`}
                  className="min-w-0 px-2"
                  type="date"
                  value={to}
                  min={minDate && dateKey(minDate)}
                  max={maxDate && dateKey(maxDate)}
                  aria-describedby={`${id}-status`}
                  aria-invalid={!!from && !!to && !!error}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
            <Calendar
              mode="range"
              month={month}
              onMonthChange={setMonth}
              selected={{ from: parseDate(from), to: parseDate(to) }}
              disabled={(date) => !isDateAllowed(date, minDate, maxDate)}
              excludeDisabled
              onSelect={(range) => {
                setFrom(range?.from ? dateKey(range.from) : "");
                setTo(range?.to ? dateKey(range.to) : "");
              }}
            />
          </div>
        </div>
        <p
          id={`${id}-status`}
          role="status"
          className="my-2 min-h-8 max-w-80 shrink-0 text-xs text-muted-foreground"
        >
          {error ?? "Período pronto para aplicar."}
        </p>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            Limpar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!!error}
            onClick={() => {
              if (!error) {
                onChange({ from: parseDate(from)!, to: parseDate(to)! });
                setOpen(false);
              }
            }}
          >
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

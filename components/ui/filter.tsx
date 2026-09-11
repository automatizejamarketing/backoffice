"use client";
import { useId, useState, type ReactNode } from "react";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DATE_OPERATOR_LABELS,
  DATE_OPERATORS,
  dateKey,
  formatDateCondition,
  getDatePresets,
  isDateAllowed,
  isDateOperator,
  parseDate,
  validateDateRange,
  type DateCondition,
  type DateOperator,
} from "@/lib/dates";
import { cn } from "@/lib/utils";
export type { DateCondition, DateOperator } from "@/lib/dates";

export type FilterOption = { value: string; label: string };

const ALL = "__all__";

export type FilterSelectProps = {
  /** Nome da dimensão, visível no gatilho ("Status: Aprovado"). */
  label: string;
  /** `undefined` é "todos" e só é válido quando `allLabel` existe. */
  value: string | undefined;
  onValueChange: (value: string | undefined) => void;
  options: FilterOption[];
  /** Texto da opção que remove o recorte. Sem ele, o filtro sempre tem um valor. */
  allLabel?: string;
  className?: string;
  disabled?: boolean;
};

/** Recorte de uma lista por uma dimensão. Controlado; quem filtra é o produto. */
export function FilterSelect({
  label,
  value,
  onValueChange,
  options,
  allLabel,
  className,
  disabled,
}: FilterSelectProps) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onValueChange(next === ALL ? undefined : next)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        className={cn("w-fit min-w-40 gap-2", className)}
      >
        <span className="shrink-0 text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allLabel ? <SelectItem value={ALL}>{allLabel}</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type FilterDateProps = {
  /** Nome do campo filtrado, visível no gatilho ("Cadastro: Antes de 10/09/2026"). */
  label: string;
  /** `undefined` é "sem recorte". Só muda ao Aplicar ou Limpar. */
  value: DateCondition | undefined;
  onChange: (condition: DateCondition | undefined) => void;
  minDate?: Date;
  maxDate?: Date;
  className?: string;
  disabled?: boolean;
};

/** Atalhos de data única: hoje e alguns dias atrás. */
function getSingleDatePresets(today = new Date()) {
  const day = (offset: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return [
    { id: "today", label: "Hoje", date: day(0) },
    { id: "yesterday", label: "Ontem", date: day(-1) },
    { id: "weekAgo", label: "Há 7 dias", date: day(-7) },
    { id: "monthAgo", label: "Há 30 dias", date: day(-30) },
  ];
}

function validateSingleDate(
  value: string,
  minDate?: Date,
  maxDate?: Date,
): string | null {
  const date = parseDate(value);
  if (!date) return "Informe a data.";
  if (!isDateAllowed(date, minDate, maxDate)) {
    return "Escolha uma data dentro do período permitido.";
  }
  return null;
}

/**
 * Recorte por data com operador, como no Notion: entre, antes de, depois de
 * ou em um dia. "Antes de" e "Depois de" não incluem o próprio dia. O valor só
 * sai ao Aplicar; cancelar, Escape ou clique fora descartam o rascunho.
 */
export function FilterDate({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  className,
  disabled,
}: FilterDateProps) {
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState<DateOperator>("between");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState("");
  const [month, setMonth] = useState(new Date());
  const id = useId();

  const error =
    op === "between"
      ? validateDateRange(from, to, minDate, maxDate)
      : validateSingleDate(date, minDate, maxDate);
  const display = value ? formatDateCondition(value) : "Selecionar";

  function loadDraft(condition?: DateCondition) {
    setOp(condition?.op ?? "between");
    setFrom(condition?.op === "between" ? condition.from : "");
    setTo(condition?.op === "between" ? condition.to : "");
    setDate(condition && condition.op !== "between" ? condition.date : "");
    const anchor =
      condition?.op === "between"
        ? parseDate(condition.from)
        : condition
          ? parseDate(condition.date)
          : undefined;
    setMonth(anchor ?? minDate ?? new Date());
  }

  function apply() {
    if (error) return;
    onChange(op === "between" ? { op, from, to } : { op, date });
    setOpen(false);
  }

  const rangePresets = getDatePresets();
  const singlePresets = getSingleDatePresets();

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) loadDraft(value);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={`${label}: ${display}`}
          className={cn("max-w-full justify-start", className)}
        >
          <CalendarIcon />
          <span className="shrink-0 text-muted-foreground">{label}:</span>
          <span className="truncate">{display}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={label}
        collisionPadding={8}
        className="flex w-auto max-w-[calc(100vw-16px)] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden p-2"
      >
        <div className="flex items-center gap-2 px-1 pb-2">
          <span className="text-sm font-semibold">{label}</span>
          <Select
            value={op}
            onValueChange={(next) => {
              if (isDateOperator(next)) setOp(next);
            }}
          >
            <SelectTrigger aria-label="Operador" size="sm" className="ml-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_OPERATORS.map((operator) => (
                <SelectItem key={operator} value={operator}>
                  {DATE_OPERATOR_LABELS[operator]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto sm:flex-row">
          <div
            aria-label="Atalhos"
            className="flex shrink-0 w-[280px] max-w-full gap-1 overflow-x-auto sm:w-36 sm:flex-col sm:border-r sm:pr-2 [@media(pointer:coarse)]:w-[308px] sm:[@media(pointer:coarse)]:w-36"
          >
            {op === "between"
              ? rangePresets.map((preset) => {
                  const presetFrom = dateKey(preset.range.from);
                  const presetTo = dateKey(preset.range.to);
                  return (
                    <Button
                      key={preset.id}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="shrink-0 justify-start"
                      aria-pressed={from === presetFrom && to === presetTo}
                      disabled={
                        !!validateDateRange(presetFrom, presetTo, minDate, maxDate)
                      }
                      onClick={() => {
                        setFrom(presetFrom);
                        setTo(presetTo);
                        setMonth(preset.range.from);
                      }}
                    >
                      {preset.label}
                    </Button>
                  );
                })
              : singlePresets.map((preset) => {
                  const presetDate = dateKey(preset.date);
                  return (
                    <Button
                      key={preset.id}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="shrink-0 justify-start"
                      aria-pressed={date === presetDate}
                      disabled={!!validateSingleDate(presetDate, minDate, maxDate)}
                      onClick={() => {
                        setDate(presetDate);
                        setMonth(preset.date);
                      }}
                    >
                      {preset.label}
                    </Button>
                  );
                })}
          </div>

          <div className="flex min-w-0 shrink-0 flex-col gap-2">
            {op === "between" ? (
              <>
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
                        const parsed = parseDate(e.target.value);
                        if (parsed) setMonth(parsed);
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
                  disabled={(day) => !isDateAllowed(day, minDate, maxDate)}
                  excludeDisabled
                  onSelect={(range) => {
                    setFrom(range?.from ? dateKey(range.from) : "");
                    setTo(range?.to ? dateKey(range.to) : "");
                  }}
                />
              </>
            ) : (
              <>
                <div className="w-[280px] max-w-full [@media(pointer:coarse)]:w-[308px]">
                  <Field>
                    <FieldLabel htmlFor={`${id}-date`}>
                      {DATE_OPERATOR_LABELS[op]}
                    </FieldLabel>
                    <Input
                      id={`${id}-date`}
                      className="min-w-0 px-2"
                      type="date"
                      value={date}
                      min={minDate && dateKey(minDate)}
                      max={maxDate && dateKey(maxDate)}
                      aria-describedby={`${id}-status`}
                      aria-invalid={!!date && !!error}
                      onChange={(e) => {
                        setDate(e.target.value);
                        const parsed = parseDate(e.target.value);
                        if (parsed) setMonth(parsed);
                      }}
                    />
                  </Field>
                </div>
                <Calendar
                  mode="single"
                  month={month}
                  onMonthChange={setMonth}
                  selected={parseDate(date)}
                  disabled={(day) => !isDateAllowed(day, minDate, maxDate)}
                  onSelect={(day) => setDate(day ? dateKey(day) : "")}
                />
              </>
            )}
          </div>
        </div>

        <div className="mt-2 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-2">
          <p
            id={`${id}-status`}
            role="status"
            className="min-w-0 px-1 text-xs text-muted-foreground"
          >
            {error ??
              (op === "before" || op === "after"
                ? "Não inclui o próprio dia."
                : "Pronto para aplicar.")}
          </p>
          <div className="ml-auto flex gap-2">
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={!!error} onClick={apply}>
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export type FilterBarProps = {
  label?: string;
  /** Quantos filtros estão fora de "todos". Zero esconde o botão de limpar sem mover a linha. */
  activeCount?: number;
  onClear?: () => void;
  className?: string;
  children: ReactNode;
};

/** Linha de filtros com limpeza num clique. */
export function FilterBar({
  label = "Filtros",
  activeCount = 0,
  onClear,
  className,
  children,
}: FilterBarProps) {
  const inactive = activeCount === 0;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-3", className)}
    >
      {children}
      {onClear ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={inactive}
          className={cn(inactive && "invisible")}
        >
          <X />
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}

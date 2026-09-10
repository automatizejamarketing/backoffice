"use client";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

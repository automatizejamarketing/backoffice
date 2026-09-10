"use client";
import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type MultiSelectOption = { value: string; label: string };

export type MultiSelectProps = {
  /** Nome da dimensão, visível no gatilho ("Produto: 2 selecionados"). */
  label: string;
  options: MultiSelectOption[];
  /** Vazio significa "todos". */
  value: string[];
  onValueChange: (value: string[]) => void;
  /** Texto mostrado quando nada está selecionado. */
  allLabel?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Seleção múltipla com busca. Controlado; o gatilho mantém a largura entre
 * zero, um e vários itens porque só o texto muda, nunca a estrutura.
 */
export function MultiSelect({
  label,
  options,
  value,
  onValueChange,
  allLabel = "Todos",
  searchPlaceholder = "Buscar…",
  emptyText = "Nenhuma opção encontrada.",
  className,
  disabled,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);
  const summary =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? (options.find((option) => option.value === value[0])?.label ?? value[0])
        : `${value.length} selecionados`;

  function toggle(optionValue: string) {
    onValueChange(
      selected.has(optionValue)
        ? value.filter((item) => item !== optionValue)
        : [...value, optionValue],
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`${label}: ${summary}`}
          disabled={disabled}
          className={cn("w-fit min-w-48 max-w-full justify-between gap-2 font-normal", className)}
        >
          <span className="shrink-0 text-muted-foreground">{label}:</span>
          <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
          <ChevronsUpDown className="shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command label={label}>
          <CommandInput placeholder={searchPlaceholder} aria-label={`Buscar ${label.toLocaleLowerCase("pt-BR")}`} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = selected.has(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    aria-selected={checked}
                    onSelect={() => toggle(option.value)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      <Check className={cn("size-3", !checked && "invisible")} />
                    </span>
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
            <Badge variant="outline" className={cn(value.length === 0 && "invisible")}>
              {value.length} {value.length === 1 ? "selecionado" : "selecionados"}
            </Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={value.length === 0}
              onClick={() => onValueChange([])}
            >
              <X />
              Limpar
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

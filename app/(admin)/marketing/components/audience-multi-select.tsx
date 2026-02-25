"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { X, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type AudienceOption = {
  id: string;
  name: string;
  subtype?: string;
  approximateCount?: number;
};

type AudienceMultiSelectProps = {
  label: string;
  placeholder?: string;
  audiences: AudienceOption[];
  selected: AudienceOption[];
  onChange: (selected: AudienceOption[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
};

export function AudienceMultiSelect({
  label,
  placeholder = "Buscar público...",
  audiences,
  selected,
  onChange,
  disabled = false,
  isLoading = false,
}: AudienceMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedIds = useMemo(
    () => new Set(selected.map((a) => a.id)),
    [selected],
  );

  const handleToggle = (audience: AudienceOption) => {
    if (selectedIds.has(audience.id)) {
      onChange(selected.filter((a) => a.id !== audience.id));
    } else {
      onChange([...selected, audience]);
    }
  };

  const handleRemove = (audienceId: string) => {
    onChange(selected.filter((a) => a.id !== audienceId));
  };

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="space-y-2" ref={containerRef}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        className="flex w-full items-center justify-between min-h-9 rounded-md border border-input bg-background px-3 py-2 text-sm text-left cursor-pointer hover:bg-accent/50 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {selected.length > 0 ? (
          <span className="text-sm">
            {selected.length} público(s) selecionado(s)
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{label}</span>
        )}
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="rounded-md border border-input bg-popover shadow-sm">
          <Command>
            <CommandInput placeholder={placeholder} />
            <CommandList className="max-h-48">
              <CommandEmpty>
                {isLoading
                  ? "Carregando públicos..."
                  : "Nenhum público encontrado."}
              </CommandEmpty>
              <CommandGroup>
                {audiences.map((audience) => (
                  <CommandItem
                    key={audience.id}
                    value={`${audience.name} ${audience.id}`}
                    onSelect={() => handleToggle(audience)}
                    data-checked={selectedIds.has(audience.id) || undefined}
                  >
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="truncate">{audience.name}</span>
                      {audience.subtype && (
                        <span className="text-[10px] text-muted-foreground">
                          {audience.subtype}
                          {audience.approximateCount !== undefined &&
                            ` · ~${audience.approximateCount.toLocaleString("pt-BR")}`}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((audience) => (
            <Badge
              key={audience.id}
              variant="secondary"
              className="gap-1 pr-1"
            >
              <span className="truncate max-w-[150px]">{audience.name}</span>
              <button
                type="button"
                onClick={() => handleRemove(audience.id)}
                disabled={disabled}
                className="rounded-full hover:bg-foreground/10 p-0.5"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

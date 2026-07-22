"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { DateRangeDialog } from "@/components/date-range-dialog";
import {
  DEFAULT_PAGE_SIZE,
  MIN_SEARCH_LENGTH,
  PAGE_SIZE_OPTIONS,
} from "./constants";
import type { UsersFilterParams } from "@/lib/backoffice/users-filters";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

type UsersTableToolbarProps = {
  initialSearch: string;
  pageSize: number;
  filters: Pick<
    UsersFilterParams,
    | "subscriptionStatus"
    | "planPeriod"
    | "metaStatus"
    | "campaignStatus"
    | "performanceStatus"
    | "renewalWithin"
    | "sort"
    | "consultantId"
    | "signupWithin"
    | "signupFrom"
    | "signupTo"
  >;
  consultants: Array<{ id: string; email: string; name: string | null }>;
};

const SORT_LABELS: Record<string, string> = {
  default: "Ordenação padrão",
  renewal: "Priorizar renovação",
  performance: "Priorizar queda 7d",
  campaign: "Priorizar campanha ativa",
};

type FilterOption = { value: string; label: string };

type FilterSection = {
  key: keyof Pick<
    UsersFilterParams,
    | "renewalWithin"
    | "performanceStatus"
    | "campaignStatus"
    | "metaStatus"
    | "subscriptionStatus"
    | "planPeriod"
    | "signupWithin"
    | "consultantId"
  >;
  label: string;
  options: FilterOption[];
};

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

function OptionRow({
  selected,
  label,
  onSelect,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        selected
          ? "bg-accent font-medium text-accent-foreground"
          : "hover:bg-muted/70",
      )}
    >
      <span
        className={cn(
          "mr-2 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-foreground" : "border-muted-foreground/40",
        )}
      >
        {selected ? (
          <span className="size-1.5 rounded-full bg-foreground" />
        ) : null}
      </span>
      {label}
    </button>
  );
}

export function UsersTableToolbar({
  initialSearch,
  pageSize,
  filters,
  consultants,
}: UsersTableToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialSearch);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isCustomDateOpen, setIsCustomDateOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRunRef = useRef(true);

  function buildUrl(updates: Record<string, string | null>): string {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("page");
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  useEffect(() => {
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      return;
    }

    const trimmed = search.trim();
    if (trimmed.length > 0 && trimmed.length < MIN_SEARCH_LENGTH) {
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      router.replace(buildUrl({ q: trimmed.length === 0 ? null : trimmed }), {
        scroll: false,
      });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const trimmedSearch = search.trim();
  const isBelowMinSearch =
    trimmedSearch.length > 0 && trimmedSearch.length < MIN_SEARCH_LENGTH;

  const sections: FilterSection[] = useMemo(
    () => [
      {
        key: "renewalWithin",
        label: "Renovação",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "1d", label: "Vence em 1 dia" },
          { value: "3d", label: "Vence em 3 dias" },
          { value: "7d", label: "Vence em 7 dias" },
        ],
      },
      {
        key: "performanceStatus",
        label: "Performance",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "drop", label: "Com queda 7d" },
          { value: "no_drop", label: "Sem queda 7d" },
          { value: "error", label: "Erro na checagem" },
          { value: "unchecked", label: "Não verificado" },
        ],
      },
      {
        key: "campaignStatus",
        label: "Campanha",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "active", label: "Campanha ativa" },
          { value: "inactive", label: "Sem campanha ativa" },
          { value: "unchecked", label: "Não verificada" },
        ],
      },
      {
        key: "metaStatus",
        label: "Meta",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "connected", label: "Conectado" },
          { value: "disconnected", label: "Sem Meta" },
        ],
      },
      {
        key: "subscriptionStatus",
        label: "Assinatura",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "active", label: "Ativas" },
          { value: "trialing", label: "Em trial" },
          { value: "past_due", label: "Pagamento pendente" },
          { value: "canceled", label: "Canceladas" },
          { value: "none", label: "Sem assinatura" },
          { value: "unpaid", label: "Não pagas" },
          { value: "incomplete", label: "Incompletas" },
          { value: "incomplete_expired", label: "Incompletas expiradas" },
        ],
      },
      {
        key: "planPeriod",
        label: "Plano",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "monthly", label: "Mensal" },
          { value: "quarterly", label: "Trimestral" },
          { value: "semiannual", label: "Semestral" },
          { value: "annual", label: "Anual" },
        ],
      },
      {
        key: "signupWithin",
        label: "Cadastro",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "3d", label: "Últimos 3 dias" },
          { value: "7d", label: "Últimos 7 dias" },
          { value: "14d", label: "Últimos 14 dias" },
          { value: "30d", label: "Últimos 30 dias" },
          { value: "custom", label: "Período personalizado" },
        ],
      },
      {
        key: "consultantId",
        label: "Consultor",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "unassigned", label: "Sem consultor" },
          ...consultants.map((consultant) => ({
            value: consultant.id,
            label: consultant.name
              ? `${consultant.name} (${consultant.email})`
              : consultant.email,
          })),
        ],
      },
    ],
    [consultants],
  );

  function handlePageSizeChange(value: string) {
    const next = Number.parseInt(value, 10) === DEFAULT_PAGE_SIZE ? null : value;
    router.push(buildUrl({ pageSize: next }), { scroll: false });
  }

  function handleDimensionChange(
    key: FilterSection["key"],
    value: string,
  ) {
    if (key === "signupWithin" && value === "custom") {
      setIsCustomDateOpen(true);
      return;
    }

    const updates: Record<string, string | null> = {
      [key]: value === "all" ? null : value,
    };

    if (key === "subscriptionStatus" && value === "none") {
      updates.planPeriod = null;
    }
    if (key === "signupWithin") {
      updates.signupFrom = null;
      updates.signupTo = null;
    }

    router.push(buildUrl(updates), { scroll: false });
  }

  function clearAllFilters() {
    router.push(
      buildUrl({
        renewalWithin: null,
        performanceStatus: null,
        campaignStatus: null,
        metaStatus: null,
        subscriptionStatus: null,
        planPeriod: null,
        consultantId: null,
        signupWithin: null,
        signupFrom: null,
        signupTo: null,
      }),
      { scroll: false },
    );
  }

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: Record<string, string | null> }> =
      [];

    for (const section of sections) {
      const current = filters[section.key];
      if (!current || current === "all") continue;

      if (
        section.key === "signupWithin" &&
        current === "custom" &&
        filters.signupFrom &&
        filters.signupTo
      ) {
        chips.push({
          key: "signupWithin",
          label: `Cadastro: ${formatDisplayDate(filters.signupFrom)} – ${formatDisplayDate(filters.signupTo)}`,
          clear: {
            signupWithin: null,
            signupFrom: null,
            signupTo: null,
          },
        });
        continue;
      }

      const option = section.options.find((row) => row.value === current);
      chips.push({
        key: section.key,
        label: `${section.label}: ${option?.label ?? current}`,
        clear:
          section.key === "signupWithin"
            ? {
                signupWithin: null,
                signupFrom: null,
                signupTo: null,
              }
            : { [section.key]: null },
      });
    }

    return chips;
  }, [filters, sections]);

  const hasCustomSignupRange =
    filters.signupWithin === "custom" &&
    Boolean(filters.signupFrom) &&
    Boolean(filters.signupTo);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5 sm:max-w-sm sm:flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por email ou nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9 text-sm"
              aria-label="Buscar usuários por email ou nome"
            />
          </div>
          {isBelowMinSearch && (
            <p className="text-xs text-muted-foreground">
              Digite ao menos {MIN_SEARCH_LENGTH} caracteres para buscar
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Por página</span>
          <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5">
              <Filter className="size-3.5" />
              Filtros
              {activeChips.length > 0 ? (
                <Badge
                  variant="secondary"
                  className="ml-0.5 h-5 min-w-5 justify-center px-1.5 text-[11px]"
                >
                  {activeChips.length}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-[min(92vw,720px)] max-h-[min(70vh,560px)] overflow-y-auto p-3"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Filtros</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={activeChips.length === 0}
                onClick={clearAllFilters}
              >
                Limpar tudo
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {sections.map((section) => {
                const current = filters[section.key];
                return (
                  <div key={section.key} className="space-y-1">
                    <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </p>
                    <div className="space-y-0.5">
                      {section.options.map((option) => (
                        <OptionRow
                          key={option.value}
                          selected={current === option.value}
                          label={option.label}
                          onSelect={() =>
                            handleDimensionChange(section.key, option.value)
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        <Select
          value={filters.sort}
          onValueChange={(value) =>
            router.push(
              buildUrl({ sort: value === "default" ? null : value }),
              { scroll: false },
            )
          }
        >
          <SelectTrigger className="h-8 w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeChips.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeChips.map((chip) => (
              <Badge
                key={chip.key}
                variant="secondary"
                className="h-7 gap-1 pl-2.5 pr-1 font-normal"
              >
                {chip.label}
                <button
                  type="button"
                  aria-label={`Remover filtro ${chip.label}`}
                  className="rounded-sm p-0.5 hover:bg-muted"
                  onClick={() =>
                    router.push(buildUrl(chip.clear), { scroll: false })
                  }
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <DateRangeDialog
        open={isCustomDateOpen}
        onOpenChange={setIsCustomDateOpen}
        initialRange={
          hasCustomSignupRange && filters.signupFrom && filters.signupTo
            ? {
                from: parseLocalDate(filters.signupFrom),
                to: parseLocalDate(filters.signupTo),
              }
            : undefined
        }
        onApply={(range) => {
          router.push(
            buildUrl({
              signupWithin: "custom",
              signupFrom: formatLocalDate(range.from),
              signupTo: formatLocalDate(range.to),
            }),
            { scroll: false },
          );
        }}
        disabledAfter={new Date()}
      />
    </div>
  );
}

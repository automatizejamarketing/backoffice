"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  CircleAlert,
  Download,
  Filter,
  Info,
  LoaderCircle,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import type {
  UserFieldFilterField,
  UserFieldFilterOperator,
  UsersFilterParams,
} from "@/lib/backoffice/users-filters";
import { ACCOUNT_STATUS_FILTER_DESCRIPTIONS, ACCOUNT_STATUS_FILTER_LABELS } from "@/lib/backoffice/account-status-filter";
import type { AccountStatusFilter } from "@/lib/backoffice/account-status-filter";
import type { UserExpirationDayCounts } from "@/lib/db/admin-queries";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUsersNavigation } from "./users-navigation-feedback";

const DEBOUNCE_MS = 300;

type UsersTableToolbarProps = {
  initialSearch: string;
  pageSize: number;
  filters: Pick<
    UsersFilterParams,
    | "subscriptionStatus"
    | "planPeriod"
    | "metaStatus"
    | "activationStatus"
    | "campaignStatus"
    | "performanceStatus"
    | "accessExpiration"
    | "accountStatus"
    | "fieldFilter"
    | "sort"
    | "consultantId"
    | "signupWithin"
    | "signupFrom"
    | "signupTo"
  >;
  consultants: Array<{ id: string; email: string; name: string | null }>;
  expirationDayCounts?: UserExpirationDayCounts;
};

const SORT_LABELS: Record<string, string> = {
  default: "Ordenação padrão",
  renewal: "Priorizar expiração",
  performance: "Priorizar queda 7d",
  campaign: "Priorizar campanha ativa",
};

const FIELD_FILTER_OPTIONS: Array<{
  value: UserFieldFilterField;
  label: string;
  inputType: "date" | "number";
}> = [
  {
    value: "expirationDate",
    label: "Data de expiração",
    inputType: "date",
  },
  { value: "createdAt", label: "Data de cadastro", inputType: "date" },
  { value: "credits", label: "Créditos", inputType: "number" },
];

const FIELD_OPERATOR_OPTIONS: Array<{
  value: UserFieldFilterOperator;
  label: string;
}> = [
  { value: "lt", label: "Menor que" },
  { value: "eq", label: "Igual a" },
  { value: "gt", label: "Maior que" },
];

type FilterOption = { value: string; label: string };

type FilterSection = {
  key: keyof Pick<
    UsersFilterParams,
    | "accessExpiration"
    | "accountStatus"
    | "performanceStatus"
    | "campaignStatus"
    | "metaStatus"
    | "activationStatus"
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
  infoDescription,
  loading = false,
  disabled = false,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  infoDescription?: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center rounded-md pr-1 transition-colors",
        selected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-muted/70",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-busy={loading}
        className={cn(
          "flex min-w-0 flex-1 items-center px-2 py-1.5 text-left text-sm",
          selected && "font-medium",
        )}
      >
        <span
          className={cn(
            "mr-2 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-foreground" : "border-muted-foreground/40",
          )}
        >
          {loading ? (
            <LoaderCircle className="size-2.5 animate-spin" />
          ) : selected ? (
            <span className="size-1.5 rounded-full bg-foreground" />
          ) : null}
        </span>
        <span className="truncate">{label}</span>
      </button>
      {infoDescription ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Sobre o filtro ${label}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {infoDescription}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function UsersTableToolbar({
  initialSearch,
  pageSize,
  filters,
  consultants,
  expirationDayCounts,
}: UsersTableToolbarProps) {
  const { isFetching, navigate } = useUsersNavigation();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialSearch);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isCustomDateOpen, setIsCustomDateOpen] = useState(false);
  const [pendingExpirationDate, setPendingExpirationDate] = useState<
    string | null
  >(null);
  const [pendingFilterKey, setPendingFilterKey] = useState<string | null>(null);
  const [fieldFilterField, setFieldFilterField] =
    useState<UserFieldFilterField>(
      filters.fieldFilter?.field ?? "expirationDate",
    );
  const [fieldFilterOperator, setFieldFilterOperator] =
    useState<UserFieldFilterOperator>(filters.fieldFilter?.operator ?? "lt");
  const [fieldFilterValue, setFieldFilterValue] = useState(
    filters.fieldFilter?.value ?? "",
  );
  const [isExporting, setIsExporting] = useState(false);
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

  function buildExportUrl(): string {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("page");
    params.delete("pageSize");
    const qs = params.toString();
    return qs ? `/api/users/export?${qs}` : "/api/users/export";
  }

  function parseExportFilename(contentDisposition: string | null): string {
    if (!contentDisposition) return "usuarios.csv";

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1]);
    }

    const asciiMatch = contentDisposition.match(/filename="([^"]+)"/i);
    return asciiMatch?.[1] ?? "usuarios.csv";
  }

  async function handleExportCsv() {
    if (isExporting) return;

    setIsExporting(true);
    try {
      const response = await fetch(buildExportUrl());

      if (!response.ok) {
        let message = "Não foi possível exportar os usuários.";
        try {
          const payload = (await response.json()) as { message?: string };
          if (payload.message) message = payload.message;
        } catch {
          // Keep default message when the error body is not JSON.
        }
        toast.error(message);
        return;
      }

      const blob = await response.blob();
      const filename = parseExportFilename(
        response.headers.get("Content-Disposition"),
      );
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success("CSV exportado com sucesso.");
    } catch {
      toast.error("Erro inesperado ao exportar o CSV.");
    } finally {
      setIsExporting(false);
    }
  }

  function navigateWithFeedback(
    href: string,
    options: { replace?: boolean; scroll?: boolean } = { scroll: false },
  ) {
    setPendingExpirationDate(null);
    navigate(href, options);
  }

  useEffect(() => {
    if (!isFetching) {
      setPendingFilterKey(null);
    }
  }, [isFetching]);

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
      navigateWithFeedback(
        buildUrl({ q: trimmed.length === 0 ? null : trimmed }),
        { replace: true, scroll: false },
      );
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    setFieldFilterField(filters.fieldFilter?.field ?? "expirationDate");
    setFieldFilterOperator(filters.fieldFilter?.operator ?? "lt");
    setFieldFilterValue(filters.fieldFilter?.value ?? "");
  }, [filters.fieldFilter]);

  const trimmedSearch = search.trim();
  const isBelowMinSearch =
    trimmedSearch.length > 0 && trimmedSearch.length < MIN_SEARCH_LENGTH;
  const selectedFieldFilter =
    FIELD_FILTER_OPTIONS.find((option) => option.value === fieldFilterField) ??
    FIELD_FILTER_OPTIONS[0];

  const sections: FilterSection[] = useMemo(
    () => [
      {
        key: "accessExpiration",
        label: "Expiração do acesso",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "next_1d", label: "Expira nas próximas 24h" },
          { value: "next_3d", label: "Expira nos próximos 3 dias" },
          { value: "next_7d", label: "Expira nos próximos 7 dias" },
          { value: "past_3d", label: "Expirou nos últimos 3 dias" },
          { value: "past_7d", label: "Expirou nos últimos 7 dias" },
          { value: "past_14d", label: "Expirou nos últimos 14 dias" },
          { value: "past_30d", label: "Expirou nos últimos 30 dias" },
          { value: "expired", label: "Já expirou (qualquer data)" },
          { value: "missing", label: "Sem data de expiração" },
        ],
      },
      {
        key: "accountStatus",
        label: "Status da conta",
        options: [
          { value: "all", label: "Qualquer" },
          ...Object.entries(ACCOUNT_STATUS_FILTER_LABELS).map(
            ([value, label]) => ({ value, label }),
          ),
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
        key: "subscriptionStatus",
        label: "Cobrança",
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
      {
        key: "activationStatus",
        label: "Ativação da conta",
        options: [
          { value: "all", label: "Qualquer" },
          { value: "pending", label: "Não ativou" },
          { value: "active", label: "Ativou" },
        ],
      },
    ],
    [consultants],
  );

  function handlePageSizeChange(value: string) {
    const next = Number.parseInt(value, 10) === DEFAULT_PAGE_SIZE ? null : value;
    navigateWithFeedback(buildUrl({ pageSize: next }));
  }

  function handleFieldFilterFieldChange(value: string) {
    setFieldFilterField(value as UserFieldFilterField);
    setFieldFilterOperator("lt");
    setFieldFilterValue("");
  }

  function applyFieldFilter() {
    if (!fieldFilterValue.trim()) return;
    navigateWithFeedback(
      buildUrl({
        filterField: fieldFilterField,
        filterOperator: fieldFilterOperator,
        filterValue: fieldFilterValue.trim(),
      }),
      { scroll: false },
    );
  }

  function clearFieldFilter() {
    setFieldFilterField("expirationDate");
    setFieldFilterOperator("lt");
    setFieldFilterValue("");
    navigateWithFeedback(
      buildUrl({
        filterField: null,
        filterOperator: null,
        filterValue: null,
      }),
      { scroll: false },
    );
  }

  function isExpirationShortcutActive(date: string): boolean {
    return (
      filters.accessExpiration === "all" &&
      filters.fieldFilter?.field === "expirationDate" &&
      filters.fieldFilter.operator === "eq" &&
      filters.fieldFilter.value === date
    );
  }

  function handleExpirationShortcut(date: string) {
    const isActive = isExpirationShortcutActive(date);
    setPendingExpirationDate(date);
    navigate(
      buildUrl({
        accessExpiration: null,
        filterField: isActive ? null : "expirationDate",
        filterOperator: isActive ? null : "eq",
        filterValue: isActive ? null : date,
      }),
      { scroll: false },
    );
  }

  function handleDimensionChange(
    key: FilterSection["key"],
    value: string,
  ) {
    if (key === "signupWithin" && value === "custom") {
      setIsCustomDateOpen(true);
      return;
    }

    setPendingFilterKey(`${key}:${value}`);

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

    navigateWithFeedback(buildUrl(updates));
  }

  function clearAllFilters() {
    navigateWithFeedback(
      buildUrl({
        accessExpiration: null,
        accountStatus: null,
        filterField: null,
        filterOperator: null,
        filterValue: null,
        performanceStatus: null,
        campaignStatus: null,
        metaStatus: null,
        activationStatus: null,
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

    if (filters.fieldFilter) {
      const field = FIELD_FILTER_OPTIONS.find(
        (option) => option.value === filters.fieldFilter?.field,
      );
      const operator = FIELD_OPERATOR_OPTIONS.find(
        (option) => option.value === filters.fieldFilter?.operator,
      );
      const value =
        field?.inputType === "date"
          ? formatDisplayDate(filters.fieldFilter.value)
          : filters.fieldFilter.value;
      chips.push({
        key: "fieldFilter",
        label: `${field?.label ?? filters.fieldFilter.field} ${operator?.label.toLowerCase() ?? filters.fieldFilter.operator} ${value}`,
        clear: {
          filterField: null,
          filterOperator: null,
          filterValue: null,
        },
      });
    }

    return chips;
  }, [filters, sections]);

  const hasCustomSignupRange =
    filters.signupWithin === "custom" &&
    Boolean(filters.signupFrom) &&
    Boolean(filters.signupTo);
  const yesterdayShortcutActive = expirationDayCounts
    ? isExpirationShortcutActive(expirationDayCounts.yesterday.date)
    : false;
  const todayShortcutActive = expirationDayCounts
    ? isExpirationShortcutActive(expirationDayCounts.today.date)
    : false;
  const hasActiveExpirationShortcut =
    yesterdayShortcutActive || todayShortcutActive;
  const yesterdayShortcutFetching =
    isFetching &&
    pendingExpirationDate === expirationDayCounts?.yesterday.date;
  const todayShortcutFetching =
    isFetching &&
    pendingExpirationDate === expirationDayCounts?.today.date;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5 sm:max-w-sm sm:flex-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por email, nome, telefone ou empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9 text-sm"
              aria-label="Buscar usuários por email, nome, telefone ou empresa"
            />
          </div>
          {isBelowMinSearch && (
            <p className="text-xs text-muted-foreground">
              Digite ao menos {MIN_SEARCH_LENGTH} caracteres para buscar
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={isExporting}
            aria-busy={isExporting}
            onClick={handleExportCsv}
          >
            {isExporting ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {isExporting ? "Exportando..." : "Exportar CSV"}
          </Button>
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
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              aria-busy={isFetching}
            >
              {isFetching ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Filter className="size-3.5" />
              )}
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
            className="relative w-[min(92vw,720px)] max-h-[min(70vh,560px)] overflow-y-auto p-3"
          >
            {isFetching ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/70 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm">
                  <LoaderCircle className="size-4 animate-spin" />
                  Atualizando filtros...
                </div>
              </div>
            ) : null}
            <TooltipProvider delayDuration={200}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Filtros</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={activeChips.length === 0 || isFetching}
                onClick={clearAllFilters}
              >
                Limpar tudo
              </Button>
            </div>
            <div className="mb-4 rounded-lg border border-border/70 bg-muted/20 p-2.5">
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="text-xs font-medium text-foreground">
                  Filtro por campo
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Combine uma informação, uma condição e um valor
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="min-w-0 space-y-1 sm:w-[210px]">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Campo
                  </span>
                  <Select
                    value={fieldFilterField}
                    onValueChange={handleFieldFilterFieldChange}
                  >
                    <SelectTrigger
                      className="h-9 w-full bg-background"
                      aria-label="Campo do filtro"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_FILTER_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 space-y-1 sm:w-[150px]">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Operador
                  </span>
                  <Select
                    value={fieldFilterOperator}
                    onValueChange={(value) =>
                      setFieldFilterOperator(value as UserFieldFilterOperator)
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-full bg-background"
                      aria-label="Operador do filtro"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_OPERATOR_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <label className="min-w-0 flex-1 space-y-1 sm:min-w-[170px]">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Valor
                  </span>
                  <Input
                    type={selectedFieldFilter.inputType}
                    step={
                      selectedFieldFilter.inputType === "number" ? 1 : undefined
                    }
                    value={fieldFilterValue}
                    onChange={(event) =>
                      setFieldFilterValue(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyFieldFilter();
                    }}
                    className="h-9 bg-background"
                    aria-label={`Valor para ${selectedFieldFilter.label}`}
                  />
                </label>

                <Button
                  type="button"
                  size="sm"
                  className="h-9"
                  disabled={!fieldFilterValue.trim()}
                  onClick={applyFieldFilter}
                >
                  Aplicar
                </Button>
                {filters.fieldFilter ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2 text-muted-foreground"
                    onClick={clearFieldFilter}
                  >
                    Limpar
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {sections.map((section) => {
                const current = filters[section.key];
                return (
                  <div
                    key={section.key}
                    className={cn(
                      "space-y-1",
                      section.key === "accessExpiration" && "sm:col-span-2",
                      section.key === "accountStatus" && "sm:col-span-2",
                    )}
                  >
                    <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </p>
                    <div
                      className={cn(
                        "space-y-0.5",
                        section.key === "accessExpiration" &&
                          "sm:grid sm:grid-cols-2 sm:gap-x-3 sm:space-y-0",
                        section.key === "accountStatus" &&
                          "sm:grid sm:grid-cols-2 sm:gap-x-3 sm:space-y-0",
                      )}
                    >
                      {section.options.map((option) => {
                        const optionKey = `${section.key}:${option.value}`;
                        const isPending = pendingFilterKey === optionKey;
                        const infoDescription =
                          section.key === "accountStatus" &&
                          option.value !== "all"
                            ? ACCOUNT_STATUS_FILTER_DESCRIPTIONS[
                                option.value as Exclude<
                                  AccountStatusFilter,
                                  "all"
                                >
                              ]
                            : undefined;

                        return (
                          <OptionRow
                            key={option.value}
                            selected={current === option.value}
                            label={option.label}
                            infoDescription={infoDescription}
                            loading={isPending}
                            disabled={isFetching}
                            onSelect={() =>
                              handleDimensionChange(section.key, option.value)
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            </TooltipProvider>
          </PopoverContent>
        </Popover>

        {expirationDayCounts ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-8 rounded-full border-red-500/50 bg-red-500/10 px-2.5 font-normal text-red-700 transition-all hover:border-red-500/70 hover:bg-red-500/15 hover:text-red-800 disabled:opacity-80 dark:text-red-300 dark:hover:text-red-200",
                yesterdayShortcutActive &&
                  "border-red-600 bg-red-600 text-white shadow-sm ring-2 ring-red-500/30 hover:border-red-600 hover:bg-red-600 hover:text-white dark:bg-red-600 dark:text-white dark:hover:bg-red-600 dark:hover:text-white",
              )}
              aria-pressed={yesterdayShortcutActive}
              aria-busy={yesterdayShortcutFetching}
              disabled={isFetching}
              onClick={() =>
                handleExpirationShortcut(expirationDayCounts.yesterday.date)
              }
            >
              {yesterdayShortcutFetching ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <CircleAlert className="size-3.5" />
              )}
              <span className="font-semibold tabular-nums">
                {expirationDayCounts.yesterday.count}
              </span>
              venceram ontem
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-8 rounded-full border-amber-500/55 bg-amber-500/10 px-2.5 font-normal text-amber-800 transition-all hover:border-amber-500/75 hover:bg-amber-500/15 hover:text-amber-900 disabled:opacity-80 dark:text-amber-300 dark:hover:text-amber-200",
                todayShortcutActive &&
                  "border-amber-400 bg-amber-400 text-amber-950 shadow-sm ring-2 ring-amber-400/30 hover:border-amber-400 hover:bg-amber-400 hover:text-amber-950 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-400 dark:hover:text-amber-950",
              )}
              aria-pressed={todayShortcutActive}
              aria-busy={todayShortcutFetching}
              disabled={isFetching}
              onClick={() =>
                handleExpirationShortcut(expirationDayCounts.today.date)
              }
            >
              {todayShortcutFetching ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <TriangleAlert className="size-3.5" />
              )}
              <span className="font-semibold tabular-nums">
                {expirationDayCounts.today.count}
              </span>
              vencem hoje
            </Button>
          </>
        ) : null}

        <Select
          value={filters.sort}
          onValueChange={(value) =>
            navigateWithFeedback(
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
            {activeChips
              .filter(
                (chip) =>
                  chip.key !== "fieldFilter" || !hasActiveExpirationShortcut,
              )
              .map((chip) => (
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
                      navigateWithFeedback(buildUrl(chip.clear))
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
          navigateWithFeedback(
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

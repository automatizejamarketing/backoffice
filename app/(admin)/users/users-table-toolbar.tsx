"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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

const DEBOUNCE_MS = 300;

type UsersTableToolbarProps = {
  initialSearch: string;
  pageSize: number;
  filters: Pick<
    UsersFilterParams,
    | "subscriptionStatus"
    | "planPeriod"
    | "metaStatus"
    | "consultantId"
    | "signupWithin"
    | "signupFrom"
    | "signupTo"
  >;
  consultants: Array<{ id: string; email: string; name: string | null }>;
};

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  all: "Todas assinaturas",
  none: "Sem assinatura",
  active: "Ativas",
  trialing: "Em trial",
  past_due: "Pagamento pendente",
  canceled: "Canceladas",
  unpaid: "Não pagas",
  incomplete: "Incompletas",
  incomplete_expired: "Incompletas expiradas",
};

const PLAN_PERIOD_LABELS: Record<string, string> = {
  all: "Todos planos",
  monthly: "Mensal",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
};

const META_STATUS_LABELS: Record<string, string> = {
  all: "Todos Meta",
  connected: "Meta conectado",
  disconnected: "Sem Meta",
};

const SIGNUP_WITHIN_LABELS: Record<string, string> = {
  all: "Qualquer cadastro",
  "3d": "Últimos 3 dias",
  "7d": "Últimos 7 dias",
  "14d": "Últimos 14 dias",
  "30d": "Últimos 30 dias",
};

// Local-date helpers for the custom signup range (yyyy-mm-dd <-> Date / display).
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
  const [isCustomDateOpen, setIsCustomDateOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Avoid issuing a redundant replace() on the first render when the input is
  // initialized from the URL. Only sync after the user actually types.
  const isFirstRunRef = useRef(true);

  // Build a fresh URL preserving the existing query string except the keys we
  // want to override. Always resets `page` to 1 since changing the search or
  // page size invalidates the current offset.
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
    // Wait until the user types enough characters; an empty input is treated
    // as "clear the filter" and is allowed through immediately.
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
    // We intentionally only react to `search` changes here; the URL helpers
    // are stable enough for our needs and re-running on every navigation
    // would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const trimmedSearch = search.trim();
  const isBelowMinSearch =
    trimmedSearch.length > 0 && trimmedSearch.length < MIN_SEARCH_LENGTH;

  function handlePageSizeChange(value: string) {
    const next =
      Number.parseInt(value, 10) === DEFAULT_PAGE_SIZE
        ? null
        : value;
    router.push(buildUrl({ pageSize: next }), { scroll: false });
  }

  function handleFilterChange(key: string, value: string) {
    const updates: Record<string, string | null> = {
      [key]: value === "all" ? null : value,
    };
    // Never-subscribed users have no plan period; drop it so the two filters
    // don't AND to an empty result and the disabled control isn't left stale.
    if (key === "subscriptionStatus" && value === "none") {
      updates.planPeriod = null;
    }
    router.push(buildUrl(updates), { scroll: false });
  }

  function handleSignupWithinChange(value: string) {
    if (value === "custom") {
      // Open the picker; the URL only changes once a range is applied.
      setIsCustomDateOpen(true);
      return;
    }
    router.push(
      buildUrl({
        signupWithin: value === "all" ? null : value,
        signupFrom: null,
        signupTo: null,
      }),
      { scroll: false },
    );
  }

  const hasCustomSignupRange =
    filters.signupWithin === "custom" &&
    Boolean(filters.signupFrom) &&
    Boolean(filters.signupTo);

  const signupDisplay =
    filters.signupWithin === "custom" && filters.signupFrom && filters.signupTo
      ? `${formatDisplayDate(filters.signupFrom)} - ${formatDisplayDate(filters.signupTo)}`
      : (SIGNUP_WITHIN_LABELS[filters.signupWithin] ?? "Qualquer cadastro");

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
          <Select
            value={String(pageSize)}
            onValueChange={handlePageSizeChange}
          >
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

      <div className="flex flex-wrap gap-2">
        <Select
          value={filters.signupWithin}
          onValueChange={handleSignupWithinChange}
        >
          <SelectTrigger className="h-8 w-[190px]">
            <CalendarIcon className="mr-2 size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">
              {signupDisplay}
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Qualquer cadastro</SelectItem>
            <SelectItem value="3d">Últimos 3 dias</SelectItem>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="14d">Últimos 14 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="custom">Período personalizado</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.subscriptionStatus}
          onValueChange={(value) =>
            handleFilterChange("subscriptionStatus", value)
          }
        >
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SUBSCRIPTION_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.planPeriod}
          onValueChange={(value) => handleFilterChange("planPeriod", value)}
          disabled={filters.subscriptionStatus === "none"}
        >
          <SelectTrigger className="h-8 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PLAN_PERIOD_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.metaStatus}
          onValueChange={(value) => handleFilterChange("metaStatus", value)}
        >
          <SelectTrigger className="h-8 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(META_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.consultantId}
          onValueChange={(value) => handleFilterChange("consultantId", value)}
        >
          <SelectTrigger className="h-8 w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos consultores</SelectItem>
            <SelectItem value="unassigned">Sem consultor</SelectItem>
            {consultants.map((consultant) => (
              <SelectItem key={consultant.id} value={consultant.id}>
                {consultant.name
                  ? `${consultant.name} (${consultant.email})`
                  : consultant.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

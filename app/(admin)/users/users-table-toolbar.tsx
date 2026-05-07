"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_PAGE_SIZE,
  MIN_SEARCH_LENGTH,
  PAGE_SIZE_OPTIONS,
} from "./constants";

const DEBOUNCE_MS = 300;

type UsersTableToolbarProps = {
  initialSearch: string;
  pageSize: number;
};

export function UsersTableToolbar({
  initialSearch,
  pageSize,
}: UsersTableToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialSearch);
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

  return (
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
  );
}

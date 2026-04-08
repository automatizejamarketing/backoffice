"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";

import type {
  GeoLocationSearchResult,
  SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";

type SearchLocationsResponse = {
  data: GeoLocationSearchResult[];
};

type SearchLocationsError = {
  error: string;
  message: string;
  solution?: string;
};

type UseLocationSearchParams = {
  accountId: string | null;
  userId?: string | null;
  locale?: string;
  searchTerm: string;
  selectedLocations: SelectedGeoLocation[];
  enabled?: boolean;
};

async function fetchLocations(
  accountId: string,
  userId: string | undefined,
  locale: string | undefined,
  searchTerm: string,
): Promise<SearchLocationsResponse> {
  const params = new URLSearchParams({
    accountId,
    q: searchTerm,
  });

  if (userId) {
    params.set("userId", userId);
  }

  if (locale) {
    params.set("locale", locale);
  }

  const response = await fetch(
    `/api/meta-marketing/targeting/search-locations?${params.toString()}`,
  );

  if (!response.ok) {
    const errorData = (await response.json()) as SearchLocationsError;
    throw new Error(errorData.message ?? "Failed to search locations");
  }

  return (await response.json()) as SearchLocationsResponse;
}

export function useLocationSearch({
  accountId,
  userId,
  locale,
  searchTerm,
  selectedLocations,
  enabled = true,
}: UseLocationSearchParams) {
  const [debouncedSearchTerm] = useDebounceValue(searchTerm, 250);
  const normalizedSearchTerm = debouncedSearchTerm.trim();

  const query = useQuery({
    queryKey: ["meta-location-search", accountId, userId, locale, normalizedSearchTerm],
    queryFn: () => {
      if (!accountId) {
        throw new Error("Account ID is required");
      }

      return fetchLocations(accountId, userId ?? undefined, locale, normalizedSearchTerm);
    },
    enabled: enabled && Boolean(accountId) && Boolean(userId) && normalizedSearchTerm.length > 0,
    staleTime: 60_000,
  });

  const selectedKeys = useMemo(
    () => new Set(selectedLocations.map((location) => location.key)),
    [selectedLocations],
  );

  const results = useMemo(
    () =>
      (query.data?.data ?? []).filter((location) => !selectedKeys.has(location.key)),
    [query.data?.data, selectedKeys],
  );

  return {
    ...query,
    debouncedSearchTerm: normalizedSearchTerm,
    results,
  };
}

export type { SearchLocationsResponse };

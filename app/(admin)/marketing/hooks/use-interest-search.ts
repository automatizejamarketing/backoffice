"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";

import type {
  MetaInterestSearchResult,
  SelectedInterest,
} from "@/lib/meta-business/interest-targeting-types";

type SearchInterestsResponse = {
  data: MetaInterestSearchResult[];
};

type UseInterestSearchParams = {
  accountId: string | null;
  userId?: string | null;
  locale?: string;
  searchTerm: string;
  selectedInterests: SelectedInterest[];
  enabled?: boolean;
};

async function fetchInterests(
  accountId: string,
  userId: string | undefined,
  locale: string | undefined,
  searchTerm: string,
): Promise<SearchInterestsResponse> {
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
    `/api/meta-marketing/targeting/search-interests?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error("Failed to search interests");
  }

  return (await response.json()) as SearchInterestsResponse;
}

export function useInterestSearch({
  accountId,
  userId,
  locale,
  searchTerm,
  selectedInterests,
  enabled = true,
}: UseInterestSearchParams) {
  const [debouncedSearchTerm] = useDebounceValue(searchTerm, 250);
  const normalizedSearchTerm = debouncedSearchTerm.trim();

  const query = useQuery({
    queryKey: [
      "meta-interest-search",
      accountId,
      userId,
      locale,
      normalizedSearchTerm,
    ],
    queryFn: () => {
      if (!accountId) {
        throw new Error("Account ID is required");
      }
      return fetchInterests(
        accountId,
        userId ?? undefined,
        locale,
        normalizedSearchTerm,
      );
    },
    enabled:
      enabled &&
      Boolean(accountId) &&
      Boolean(userId) &&
      normalizedSearchTerm.length > 0,
    staleTime: 60_000,
  });

  const selectedIds = useMemo(
    () => new Set(selectedInterests.map((i) => i.id)),
    [selectedInterests],
  );

  const results = useMemo(
    () =>
      (query.data?.data ?? []).filter((interest) => !selectedIds.has(interest.id)),
    [query.data?.data, selectedIds],
  );

  return {
    ...query,
    debouncedSearchTerm: normalizedSearchTerm,
    results,
  };
}

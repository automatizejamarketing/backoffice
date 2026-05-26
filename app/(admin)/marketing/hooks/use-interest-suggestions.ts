"use client";

import { useQuery } from "@tanstack/react-query";

import type { MetaInterestSearchResult } from "@/lib/meta-business/interest-targeting-types";

type SuggestInterestsResponse = {
  data: MetaInterestSearchResult[];
};

type UseInterestSuggestionsParams = {
  accountId: string | null;
  userId?: string | null;
  locale?: string;
  names: string[];
  enabled?: boolean;
};

async function fetchSuggestions(
  accountId: string,
  userId: string | undefined,
  locale: string | undefined,
  names: string[],
): Promise<SuggestInterestsResponse> {
  const params = new URLSearchParams({
    accountId,
    names: JSON.stringify(names),
  });

  if (userId) {
    params.set("userId", userId);
  }

  if (locale) {
    params.set("locale", locale);
  }

  const response = await fetch(
    `/api/meta-marketing/targeting/suggest-interests?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error("Failed to fetch interest suggestions");
  }

  return (await response.json()) as SuggestInterestsResponse;
}

export function useInterestSuggestions({
  accountId,
  userId,
  locale,
  names,
  enabled = true,
}: UseInterestSuggestionsParams) {
  const sortedNames = [...names].sort().join("|");

  return useQuery({
    queryKey: [
      "meta-interest-suggestions",
      accountId,
      userId,
      locale,
      sortedNames,
    ],
    queryFn: () => {
      if (!accountId) {
        throw new Error("Account ID is required");
      }
      return fetchSuggestions(
        accountId,
        userId ?? undefined,
        locale,
        names,
      );
    },
    enabled:
      enabled && Boolean(accountId) && Boolean(userId) && names.length > 0,
    staleTime: 60_000,
  });
}

"use client";

import { useQuery } from "@tanstack/react-query";

import type { MetaInterestSearchResult } from "@/lib/meta-business/interest-targeting-types";

type BrowseInterestsResponse = {
  data: MetaInterestSearchResult[];
};

type UseInterestBrowseParams = {
  accountId: string | null;
  userId?: string | null;
  locale?: string;
  enabled?: boolean;
};

async function fetchBrowse(
  accountId: string,
  userId: string | undefined,
  locale: string | undefined,
): Promise<BrowseInterestsResponse> {
  const params = new URLSearchParams({ accountId });

  if (userId) {
    params.set("userId", userId);
  }

  if (locale) {
    params.set("locale", locale);
  }

  const response = await fetch(
    `/api/meta-marketing/targeting/browse-interests?${params.toString()}`,
  );

  if (!response.ok) {
    throw new Error("Failed to browse interests");
  }

  return (await response.json()) as BrowseInterestsResponse;
}

export function useInterestBrowse({
  accountId,
  userId,
  locale,
  enabled = false,
}: UseInterestBrowseParams) {
  return useQuery({
    queryKey: ["meta-interest-browse", accountId, userId, locale],
    queryFn: () => {
      if (!accountId) {
        throw new Error("Account ID is required");
      }
      return fetchBrowse(accountId, userId ?? undefined, locale);
    },
    enabled: enabled && Boolean(accountId) && Boolean(userId),
    staleTime: 120_000,
  });
}

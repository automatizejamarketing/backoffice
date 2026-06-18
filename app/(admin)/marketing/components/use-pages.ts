"use client";

import { useQuery } from "@tanstack/react-query";
import { marketingKeys } from "../hooks/marketing-query-keys";

/**
 * A Facebook Page (with its connected Instagram account) the admin can choose
 * as the ad identity. Only pages with a connected Instagram account are
 * returned by the API.
 */
export type PageIdentity = {
  pageId: string;
  pageName?: string;
  pagePictureUrl?: string;
  instagramBusinessAccountId: string;
  instagramUsername?: string;
  instagramProfilePictureUrl?: string;
};

const PAGES_STALE_TIME = 60 * 1000;

async function fetchPages(
  accountId: string,
  userId: string,
): Promise<PageIdentity[]> {
  try {
    const response = await fetch(
      `/api/meta-marketing/${accountId}/pages?userId=${userId}`,
    );
    if (!response.ok) return [];

    const data: { pages?: PageIdentity[] } = await response.json();
    return data.pages ?? [];
  } catch {
    // Selector is best-effort; leave the list empty on failure.
    return [];
  }
}

/**
 * Fetch the target user's Facebook Pages (with a connected Instagram account)
 * for the ad-identity selector. Best-effort: returns an empty list on failure.
 */
export function usePages(
  accountId: string,
  userId: string,
  enabled: boolean = true,
) {
  const query = useQuery({
    queryKey: marketingKeys.pages(accountId, userId),
    queryFn: () => fetchPages(accountId, userId),
    enabled: enabled && Boolean(accountId) && Boolean(userId),
    staleTime: PAGES_STALE_TIME,
  });

  return {
    pages: query.data ?? [],
    isLoading: query.isLoading,
  };
}

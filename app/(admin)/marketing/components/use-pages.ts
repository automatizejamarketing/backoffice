"use client";

import { useEffect, useState } from "react";

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

/**
 * Fetch the target user's Facebook Pages (with a connected Instagram account)
 * for the ad-identity selector. Best-effort: returns an empty list on failure.
 */
export function usePages(
  accountId: string,
  userId: string,
  enabled: boolean = true,
) {
  const [pages, setPages] = useState<PageIdentity[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/meta-marketing/${accountId}/pages?userId=${userId}`,
        );
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) setPages(data.pages ?? []);
        }
      } catch {
        // Selector is best-effort; leave the list empty on failure.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId, userId, enabled]);

  return { pages, isLoading };
}

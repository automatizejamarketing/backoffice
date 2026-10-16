/** Client-safe selection of explicit Page/Instagram pairs returned by the server. */
export type IdentityCandidate = {
  pageId: string;
  instagramBusinessAccountId?: string | null;
  instagramUsername?: string;
  instagramProfilePictureUrl?: string;
  isPrimary?: boolean;
  available?: boolean;
};
export type AdvertisingIdentitySelection = {
  pageId: string;
  instagramUserId?: string;
};

export function selectAdvertisingIdentity(
  pairs: readonly IdentityCandidate[],
  remembered: AdvertisingIdentitySelection | null,
  restricted: boolean,
  fixedPageId?: string | null,
): AdvertisingIdentitySelection | null {
  const available = pairs.filter(
    (p) => p.available !== false && (!fixedPageId || p.pageId === fixedPageId),
  );
  const matches = remembered
    ? available.filter(
        (p) =>
          p.pageId === remembered.pageId &&
          (!remembered.instagramUserId ||
            p.instagramBusinessAccountId === remembered.instagramUserId),
      )
    : [];
  const selected =
    matches.length === 1
      ? matches[0]
      : ((restricted ? available.find((p) => p.isPrimary) : undefined) ??
        available[0]);
  if (!selected) return null;
  return {
    pageId: selected.pageId,
    ...(selected.instagramBusinessAccountId
      ? { instagramUserId: selected.instagramBusinessAccountId }
      : {}),
  };
}

export function distinctIdentityPages<T extends IdentityCandidate>(
  pairs: readonly T[],
): T[] {
  const pages = new Map<string, T>();
  for (const pair of pairs) {
    const existing = pages.get(pair.pageId);
    if (!existing || (existing.available === false && pair.available !== false))
      pages.set(pair.pageId, pair);
  }
  return [...pages.values()];
}

export function identityInstagramAccounts(
  pairs: readonly IdentityCandidate[],
  pageId: string | null,
) {
  const accounts = new Map<
    string,
    {
      id: string;
      username?: string;
      profilePictureUrl?: string;
      isPrimary?: boolean;
      available?: boolean;
    }
  >();
  for (const pair of pairs) {
    if (
      pair.pageId !== pageId ||
      !pair.instagramBusinessAccountId ||
      pair.available === false
    )
      continue;
    accounts.set(pair.instagramBusinessAccountId, {
      id: pair.instagramBusinessAccountId,
      username: pair.instagramUsername,
      profilePictureUrl: pair.instagramProfilePictureUrl,
      isPrimary: pair.isPrimary,
      available: pair.available,
    });
  }
  return [...accounts.values()];
}

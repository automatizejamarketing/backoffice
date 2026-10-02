// Absolute (not `../api`): this file is mirrored into the backoffice's FLATTENED
// `lib/meta-business/` root, where a relative parent import would miss.
import { metaApiCall } from "@/lib/meta-business/api";
import { advertisingIdentityId } from "@/lib/meta-business/advertising-identity-key";

/**
 * Facebook Page connected to Instagram Business Account
 */
export type FacebookConnectedPage = {
  id: string;
  name?: string;
  username?: string;
  picture?: {
    data: {
      url: string;
      is_silhouette: boolean;
      height: number;
      width: number;
    };
  };
  access_token?: string;
  category?: string;
  tasks?: string[];
};

/**
 * Response from fetching user's pages
 */
export type FacebookPagesResponse = {
  data: FacebookConnectedPage[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
};

/**
 * Instagram Business Account info from Facebook Page
 */
export type InstagramBusinessAccountInfo = {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
};

/**
 * Facebook Page with Instagram Business Account
 */
export type FacebookPageWithInstagram = FacebookConnectedPage & {
  instagram_business_account?: InstagramBusinessAccountInfo;
  connected_instagram_account?: InstagramBusinessAccountInfo;
};

/**
 * Response from fetching pages with Instagram accounts
 */
export type FacebookPagesWithInstagramResponse = {
  data: FacebookPageWithInstagram[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
};

/**
 * Error response from Facebook Graph API
 */
export type FacebookGraphApiError = {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id: string;
  };
};

/**
 * A real Page and Instagram advertising pair. Account provenance authorizes
 * advertising profiles; positive Page links restrict compatible pairs.
 */
export type PageIdentity = {
  identityId?: string;
  adAccountIds?: string[];
  linkage?: "known_page" | "not_observed";
  pageId: string;
  pageName?: string;
  pagePictureUrl?: string;
  instagramBusinessAccountId: string;
  instagramUsername?: string;
  instagramProfilePictureUrl?: string;
};

/**
 * Result from getting Instagram connected page
 */
export type InstagramConnectedPageResult = {
  page: FacebookConnectedPage;
  instagramBusinessAccountId: string;
  /** Instagram username (without @) for building profile URL */
  instagramUsername?: string;
};

const PAGE_WITH_IG_FIELDS =
  "id,name,username,picture,category,tasks,instagram_business_account{id,username,name,profile_picture_url},connected_instagram_account{id,username}";

export type GetPagesOptions = {
  tokenKind?: "user" | "bisu";
  bisuAppScopedId?: string | null;
  /** Prefer pages promotable under this ad account (Ads Manager semantics). */
  adAccountId?: string;
  /** Merge promotable pages across several ad accounts. */
  adAccountIds?: string[];
  /** Explicit Instagram selection; never replaced by another profile. */
  instagramBusinessAccountId?: string;
};

/** Normalize bare / act_ ad-account ids into unique `act_` ids. */
export function normalizeActAccountIds(
  ...rawIds: Array<string | null | undefined>
): string[] {
  const ids = new Set<string>();
  for (const raw of rawIds) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    ids.add(trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`);
  }
  return [...ids];
}

export function resolveRequestedAdAccountIds(
  options: GetPagesOptions,
): string[] {
  return normalizeActAccountIds(
    options.adAccountId,
    ...(options.adAccountIds ?? []),
  );
}

/** Dedupe pages by id, preferring entries that include Instagram linkage. */
export function mergeFacebookPagesWithInstagram(
  ...lists: FacebookPageWithInstagram[][]
): FacebookPageWithInstagram[] {
  const byId = new Map<string, FacebookPageWithInstagram>();
  for (const list of lists) {
    for (const page of list) {
      if (!page?.id) continue;
      const existing = byId.get(page.id);
      if (!existing) {
        byId.set(page.id, page);
        continue;
      }
      byId.set(page.id, {
        ...existing,
        ...page,
        tasks: page.tasks?.length ? page.tasks : existing.tasks,
        picture: page.picture ?? existing.picture,
        instagram_business_account:
          page.instagram_business_account ?? existing.instagram_business_account,
      });
    }
  }
  return [...byId.values()];
}

/** Read cursors on our own endpoint; never reuse paging URLs containing tokens. */
async function fetchEdge<T>(path: string, fields: string, accessToken: string): Promise<T[]> {
  const data: T[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  do {
    const params = new URLSearchParams({ fields, limit: "100" });
    if (after) params.set("after", after);
    const response = await metaApiCall<{ data?: T[]; paging?: FacebookPagesResponse["paging"] }>({
      domain: "FACEBOOK", method: "GET", path, params: params.toString(), accessToken,
    });
    data.push(...(response.data ?? []));
    if (!response.paging?.next) break;
    after = response.paging.cursors?.after;
    if (!after || seen.has(after)) throw new Error(`Incomplete Meta pagination for ${path}`);
    seen.add(after);
  } while (after);
  return data;
}

async function fetchPromotePagesForAdAccount(
  adAccountActId: string,
  accessToken: string,
): Promise<FacebookPageWithInstagram[]> {
  return fetchEdge(`${adAccountActId}/promote_pages`, PAGE_WITH_IG_FIELDS, accessToken);
}

async function fetchAssignedPages(
  bisuAppScopedId: string,
  accessToken: string,
): Promise<FacebookPageWithInstagram[]> {
  return fetchEdge(`${bisuAppScopedId}/assigned_pages`, PAGE_WITH_IG_FIELDS, accessToken);
}

async function fetchMeAccounts(
  accessToken: string,
): Promise<FacebookPageWithInstagram[]> {
  return fetchEdge("me/accounts", PAGE_WITH_IG_FIELDS, accessToken);
}

/**
 * Get the Facebook Page connected to an Instagram Business Account.
 */
export async function getInstagramConnectedPage(
  accessToken: string,
  instagramBusinessAccountId: string,
  options?: GetPagesOptions,
): Promise<InstagramConnectedPageResult | null> {
  if (options?.adAccountId || options?.adAccountIds?.length) {
    return resolveAdvertisingIdentity(accessToken, { ...options, instagramBusinessAccountId });
  }
  const pagesResponse = await getPagesWithInstagramAccounts(accessToken, options);

  const connectedPage = pagesResponse.data.find(
    (page) => page.instagram_business_account?.id === instagramBusinessAccountId,
  );

  if (!connectedPage?.instagram_business_account?.id) {
    return null;
  }

  const { instagram_business_account, ...pageWithoutInstagram } = connectedPage;
  return {
    page: pageWithoutInstagram,
    instagramBusinessAccountId: instagram_business_account.id,
    instagramUsername: instagram_business_account.username,
  };
}

/**
 * List Facebook Pages (+ connected Instagram) using Ads Manager semantics:
 * 1) ad-account promote_pages for requested accounts (pages with admin/advertise
 *    access that can run ads under the account, even when not owned in the BM)
 * 2) BISU assigned_pages when available
 * 3) me/accounts fallback
 */
export async function getPagesWithInstagramAccounts(
  accessToken: string,
  adAccountIdOrOptions?: string | GetPagesOptions,
): Promise<FacebookPagesWithInstagramResponse> {
  const options: GetPagesOptions =
    typeof adAccountIdOrOptions === "string"
      ? { adAccountId: adAccountIdOrOptions }
      : (adAccountIdOrOptions ?? {});

  const lists: FacebookPageWithInstagram[][] = [];
  const actIds = resolveRequestedAdAccountIds(options);

  if (actIds.length > 0) {
    const promotedLists = await Promise.all(
      actIds.map(async (actId) => {
        try {
          return await fetchPromotePagesForAdAccount(actId, accessToken);
        } catch (error) {
          console.warn("promote_pages failed for ad account", {
            actId,
            error,
          });
          return [] as FacebookPageWithInstagram[];
        }
      }),
    );
    lists.push(...promotedLists);
  }

  if (options.tokenKind === "bisu" && options.bisuAppScopedId) {
    try {
      lists.push(
        await fetchAssignedPages(options.bisuAppScopedId, accessToken),
      );
    } catch (error) {
      console.warn("assigned_pages failed while listing page identities", error);
    }
  }

  try {
    lists.push(await fetchMeAccounts(accessToken));
  } catch (error) {
    // If promote_pages / assigned_pages already returned pages, keep going.
    if (lists.every((list) => list.length === 0)) {
      throw error;
    }
    console.warn("me/accounts failed while listing page identities", error);
  }

  return { data: mergeFacebookPagesWithInstagram(...lists) };
}

/**
 * Map the raw pages response to {@link PageIdentity}[] — the canonical ad-identity
 * shape (Page + connected Instagram). Pages WITHOUT a connected Instagram are
 * excluded, because the campaign-creation flow requires an Instagram identity.
 */
export function toPageIdentities(
  response: FacebookPagesWithInstagramResponse,
): PageIdentity[] {
  return response.data
    .filter((page) => page.instagram_business_account?.id)
    .map((page) => ({
      pageId: page.id,
      pageName: page.name,
      pagePictureUrl: page.picture?.data?.url,
      instagramBusinessAccountId: page.instagram_business_account!.id,
      instagramUsername: page.instagram_business_account!.username,
      instagramProfilePictureUrl:
        page.instagram_business_account!.profile_picture_url,
    }));
}

/**
 * List advertising pairs under the requested accounts, retaining each pair's
 * provenance. Omitted accounts are discovered from the current token.
 */
export async function getAdvertisingIdentities(
  accessToken: string,
  adAccountIdOrOptions?: string | GetPagesOptions,
): Promise<PageIdentity[]> {
  return (await discoverAdvertisingIdentities(accessToken, adAccountIdOrOptions)).identities;
}

/** Complete Page grants for Facebook-only creatives; permission failures propagate. */
export async function getAdvertisingPages(
  accessToken: string,
  options: GetPagesOptions & { adAccountId: string },
): Promise<FacebookPagesWithInstagramResponse> {
  const rows = (await Promise.all([
    ...resolveRequestedAdAccountIds(options).map(id => fetchPromotePagesForAdAccount(id, accessToken)),
    ...(options.tokenKind === "bisu" && options.bisuAppScopedId ? [fetchAssignedPages(options.bisuAppScopedId, accessToken)] : []),
    fetchMeAccounts(accessToken),
  ])).flat();
  return { data: mergeFacebookPagesWithInstagram(rows) };
}

async function discoverAdvertisingIdentities(accessToken: string, adAccountIdOrOptions?: string | GetPagesOptions) {
  const options = typeof adAccountIdOrOptions === "string" ? { adAccountId: adAccountIdOrOptions } : (adAccountIdOrOptions ?? {});
  let actIds = resolveRequestedAdAccountIds(options);
  if (!actIds.length) {
    const accounts = await fetchEdge<{ id: string }>("me/adaccounts", "id", accessToken);
    actIds = normalizeActAccountIds(...accounts.map(account => account.id));
  }
  // All Page sources must be complete before declaring a link not observed.
  // Keep original rows until links are collected: merging first could hide conflicts.
  const rawPages = (await Promise.all([
    ...actIds.map(id => fetchPromotePagesForAdAccount(id, accessToken)),
    ...(options.tokenKind === "bisu" && options.bisuAppScopedId ? [fetchAssignedPages(options.bisuAppScopedId, accessToken)] : []),
    fetchMeAccounts(accessToken),
  ])).flat();
  const pages = mergeFacebookPagesWithInstagram(rawPages);
  const knownPagesByIg = new Map<string, Set<string>>();
  const linkedIg = new Map<string, InstagramBusinessAccountInfo>();
  for (const page of rawPages) {
    for (const ig of [page.instagram_business_account, page.connected_instagram_account]) {
      if (!ig?.id) continue;
      const links = knownPagesByIg.get(ig.id) ?? new Set<string>();
      links.add(page.id);
      knownPagesByIg.set(ig.id, links);
      linkedIg.set(ig.id, { ...linkedIg.get(ig.id), ...ig });
    }
  }
  const identities = new Map<string, PageIdentity>();
  const add = (page: FacebookPageWithInstagram, ig: InstagramBusinessAccountInfo, accountId?: string) => {
    const links = knownPagesByIg.get(ig.id);
    if (links && (links.size !== 1 || !links.has(page.id))) return;
    const id = advertisingIdentityId(page.id, ig.id);
    const existing = identities.get(id);
    identities.set(id, {
      ...existing,
      identityId: id, pageId: page.id, pageName: page.name, pagePictureUrl: page.picture?.data?.url,
      instagramBusinessAccountId: ig.id,
      instagramUsername: ig.username ?? existing?.instagramUsername,
      instagramProfilePictureUrl: ig.profile_picture_url ?? existing?.instagramProfilePictureUrl,
      linkage: links ? "known_page" : "not_observed",
      adAccountIds: [...new Set([...(existing?.adAccountIds ?? []), ...(accountId ? [accountId] : [])])],
    });
  };
  for (const actId of actIds) {
    const accounts = await fetchEdge<InstagramBusinessAccountInfo>(`${actId}/connected_instagram_accounts`, "id,username", accessToken);
    for (const ig of accounts) {
      if (!ig.id) continue;
      for (const page of pages) add(page, { ...linkedIg.get(ig.id), ...ig }, actId);
    }
    // Preserve the existing Page-connected advertising path, even if the new
    // account edge omits that profile. A positive Page link still restricts it.
    for (const [igId, links] of knownPagesByIg) {
      if (links.size !== 1) continue;
      const page = pages.find(page => links.has(page.id));
      if (page) add(page, linkedIg.get(igId)!, actId);
    }
  }
  if (!actIds.length) {
    for (const [igId, links] of knownPagesByIg) {
      if (links.size !== 1) continue;
      const page = pages.find(page => links.has(page.id));
      if (page) add(page, linkedIg.get(igId)!);
    }
  }
  return { identities: [...identities.values()], pages };
}

export type ResolveAdvertisingIdentityOptions = GetPagesOptions & { pageId?: string };

/** Resolve only the requested pair; ambiguous legacy requests may use a unique positive Page link. */
export async function resolveAdvertisingIdentity(accessToken: string, options: ResolveAdvertisingIdentityOptions): Promise<InstagramConnectedPageResult | null> {
  const { identities, pages } = await discoverAdvertisingIdentities(accessToken, options);
  let matches = identities.filter(identity =>
    (!options.pageId || identity.pageId === options.pageId) &&
    (!options.instagramBusinessAccountId || identity.instagramBusinessAccountId === options.instagramBusinessAccountId),
  );
  if (matches.length > 1 && !options.instagramBusinessAccountId) {
    matches = matches.filter(identity => identity.linkage === "known_page");
  }
  if (matches.length !== 1) return null;
  const match = matches[0];
  const rawPage = pages.find(page => page.id === match.pageId)!;
  const { instagram_business_account: _ig, connected_instagram_account: _connected, ...page } = rawPage;
  return { page, instagramBusinessAccountId: match.instagramBusinessAccountId, instagramUsername: match.instagramUsername };
}

/**
 * Get a Facebook Page (with its connected Instagram Business Account) by Page ID.
 */
export async function getConnectedPageById(
  accessToken: string,
  pageId: string,
  options?: GetPagesOptions,
): Promise<InstagramConnectedPageResult | null> {
  if (options?.adAccountId || options?.adAccountIds?.length || options?.instagramBusinessAccountId) {
    return resolveAdvertisingIdentity(accessToken, { ...options, pageId });
  }
  const pagesResponse = await getPagesWithInstagramAccounts(accessToken, options);

  const matchedPage = pagesResponse.data.find((page) => page.id === pageId);

  if (!matchedPage?.instagram_business_account?.id) {
    return null;
  }

  const { instagram_business_account, ...pageWithoutInstagram } = matchedPage;
  return {
    page: pageWithoutInstagram,
    instagramBusinessAccountId: instagram_business_account.id,
    instagramUsername: instagram_business_account.username,
  };
}

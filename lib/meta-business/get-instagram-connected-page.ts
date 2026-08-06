// Absolute (not `../api`): this file is mirrored into the backoffice's FLATTENED
// `lib/meta-business/` root, where a relative parent import would miss.
import { metaApiCall } from "@/lib/meta-business/api";

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
 * A Facebook Page that can run ads, together with its connected Instagram
 * Business Account. This represents the ad "Identity": the user picks the Page,
 * and the Instagram profile is derived from it (mirrors Meta's Ads Manager).
 * Pages without a connected Instagram account are excluded from this shape.
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
 * Result from getting Instagram connected page
 */
export type InstagramConnectedPageResult = {
  page: FacebookConnectedPage;
  instagramBusinessAccountId: string;
  /** Instagram username (without @) for building profile URL */
  instagramUsername?: string;
};

const PAGE_WITH_IG_FIELDS =
  "id,name,username,picture,category,tasks,instagram_business_account{id,username,name,profile_picture_url}";

export type GetPagesOptions = {
  tokenKind?: "user" | "bisu";
  bisuAppScopedId?: string | null;
  /** Prefer pages promotable under this ad account (Ads Manager semantics). */
  adAccountId?: string;
  /** Merge promotable pages across several ad accounts. */
  adAccountIds?: string[];
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

async function fetchPromotePagesForAdAccount(
  adAccountActId: string,
  accessToken: string,
): Promise<FacebookPageWithInstagram[]> {
  const response = await metaApiCall<FacebookPagesWithInstagramResponse>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${adAccountActId}/promote_pages`,
    params: `fields=${PAGE_WITH_IG_FIELDS}&limit=100`,
    accessToken,
  });
  return response.data ?? [];
}

async function fetchAssignedPages(
  bisuAppScopedId: string,
  accessToken: string,
): Promise<FacebookPageWithInstagram[]> {
  const response = await metaApiCall<FacebookPagesWithInstagramResponse>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${bisuAppScopedId}/assigned_pages`,
    params: `fields=${PAGE_WITH_IG_FIELDS}&limit=100`,
    accessToken,
  });
  return response.data ?? [];
}

async function fetchMeAccounts(
  accessToken: string,
): Promise<FacebookPageWithInstagram[]> {
  const response = await metaApiCall<FacebookPagesWithInstagramResponse>({
    domain: "FACEBOOK",
    method: "GET",
    path: "me/accounts",
    params: `fields=${PAGE_WITH_IG_FIELDS}&limit=100`,
    accessToken,
  });
  return response.data ?? [];
}

/**
 * Get the Facebook Page connected to an Instagram Business Account.
 */
export async function getInstagramConnectedPage(
  accessToken: string,
  instagramBusinessAccountId: string,
  options?: GetPagesOptions,
): Promise<InstagramConnectedPageResult | null> {
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
 * THE single method to list advertising identities (Facebook Page + connected
 * Instagram). Prefer passing adAccountId(s) so listing follows Ads Manager
 * promote_pages instead of only Login-for-Business assigned assets.
 */
export async function getAdvertisingIdentities(
  accessToken: string,
  adAccountIdOrOptions?: string | GetPagesOptions,
): Promise<PageIdentity[]> {
  return toPageIdentities(
    await getPagesWithInstagramAccounts(accessToken, adAccountIdOrOptions),
  );
}

/**
 * Get a Facebook Page (with its connected Instagram Business Account) by Page ID.
 */
export async function getConnectedPageById(
  accessToken: string,
  pageId: string,
  options?: GetPagesOptions,
): Promise<InstagramConnectedPageResult | null> {
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

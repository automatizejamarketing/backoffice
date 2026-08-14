import { graphFacebookBaseUrl, graphApiVersion } from "./constant";
import { appSecretProof, facebookAppSecret } from "./appsecret-proof";
import { GraphApiError, parseGraphError } from "./error";
import { cachedMetaRead, tokenCacheId } from "./read-cache";
import type { MetaTokenKind } from "./connection-record";

/** Appends appsecret_proof when META_GENERAL_APP_SECRET is set (user/BISU token call). */
function appendAppSecretProof(
  params: URLSearchParams,
  accessToken: string,
): void {
  const secret = facebookAppSecret();
  if (secret) params.append("appsecret_proof", appSecretProof(accessToken, secret));
}

/**
 * User basic info fields from Facebook Graph API
 */
export type FacebookUserBasicInfo = {
  id: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  name?: string;
  name_format?: string;
  picture?: {
    data: {
      url: string;
      is_silhouette: boolean;
      height: number;
      width: number;
    };
  };
  short_name?: string;
  client_business_id?: string;
  token_kind?: MetaTokenKind;
};

/**
 * Ad account basic info from Facebook Graph API
 */
export type FacebookAdAccountBasicInfo = {
  id: string; // Format: "act_123456789"
  account_id: string; // Format: "123456789"
  name?: string;
  owner?: string;
  account_status?: number;
  balance?: string;
  currency?: string;
  business?: {
    id: string;
    name?: string;
  };
};

/**
 * Response structure for user with ad accounts
 */
export type FacebookUserWithAdAccountsResponse = FacebookUserBasicInfo & {
  adaccounts?: {
    data: FacebookAdAccountBasicInfo[];
    paging?: {
      cursors: {
        before: string;
        after: string;
      };
      next?: string;
    };
  };
};

export type GetUserWithAdAccountsOptions = {
  tokenKind?: MetaTokenKind;
  bisuAppScopedId?: string | null;
  clientBusinessId?: string | null;
  connectionName?: string | null;
};

type AssignedAdAccount = {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  currency?: string;
  business?: { id: string; name?: string };
};

const USER_FIELDS = [
  "id",
  "first_name",
  "last_name",
  "middle_name",
  "name",
  "name_format",
  "picture",
  "short_name",
] as const;

const AD_ACCOUNT_FIELDS = [
  "id",
  "account_id",
  "name",
  "owner",
  "account_status",
  "balance",
  "currency",
  "business{id}",
] as const;

const BISU_AD_ACCOUNT_FIELDS =
  "id,account_id,name,account_status,currency,business{id,name}";

const AD_ACCOUNTS_PAGE_LIMIT = "100";

async function fetchGraphJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.error) {
    console.error("Error fetching Facebook Graph data:", data);
    // Typed error carries code/error_subcode so callers can detect 190/460
    // (session invalidated — user must reconnect) and surface it precisely.
    throw new GraphApiError(parseGraphError(data));
  }

  return data as T;
}

async function paginateGraph<T>(
  initialUrl: string,
): Promise<T[]> {
  const visitedUrls = new Set<string>();
  const all: T[] = [];
  let nextUrl = initialUrl;

  while (nextUrl) {
    if (visitedUrls.has(nextUrl)) {
      console.warn("Detected repeated pagination URL while fetching Graph edge");
      break;
    }
    visitedUrls.add(nextUrl);

    const page = await fetchGraphJson<{
      data: T[];
      paging?: { next?: string };
    }>(nextUrl);

    all.push(...(page.data ?? []));
    nextUrl = page.paging?.next ?? "";
  }

  return all;
}

async function getFacebookUserProfile(
  accessToken: string,
): Promise<FacebookUserBasicInfo> {
  const params = new URLSearchParams({
    fields: USER_FIELDS.join(","),
    access_token: accessToken,
  });
  appendAppSecretProof(params, accessToken);

  return fetchGraphJson<FacebookUserBasicInfo>(
    `${graphFacebookBaseUrl}/${graphApiVersion}/me?${params.toString()}`,
  );
}

async function getAdAccounts(
  accessToken: string,
): Promise<FacebookUserWithAdAccountsResponse["adaccounts"]> {
  const params = new URLSearchParams({
    fields: AD_ACCOUNT_FIELDS.join(","),
    limit: AD_ACCOUNTS_PAGE_LIMIT,
    access_token: accessToken,
  });
  // Meta-returned paging.next URLs embed this query (incl. the proof), so the
  // proof only needs to be set on the first page.
  appendAppSecretProof(params, accessToken);
  const visitedUrls = new Set<string>();
  const allAccounts: FacebookAdAccountBasicInfo[] = [];
  let nextUrl =
    `${graphFacebookBaseUrl}/${graphApiVersion}/me/adaccounts?${params.toString()}`;
  let lastPage: FacebookUserWithAdAccountsResponse["adaccounts"];

  while (nextUrl) {
    if (visitedUrls.has(nextUrl)) {
      console.warn("Detected repeated pagination URL while fetching ad accounts");
      break;
    }

    visitedUrls.add(nextUrl);

    const page = await fetchGraphJson<
      NonNullable<FacebookUserWithAdAccountsResponse["adaccounts"]>
    >(nextUrl);

    lastPage = page;
    allAccounts.push(...page.data);
    nextUrl = page.paging?.next ?? "";
  }

  return {
    data: allAccounts,
    paging: lastPage?.paging,
  };
}

async function getBisuIdentity(
  accessToken: string,
): Promise<{ id: string; clientBusinessId: string }> {
  const params = new URLSearchParams({
    fields: "id,client_business_id",
    access_token: accessToken,
  });
  appendAppSecretProof(params, accessToken);

  const data = await fetchGraphJson<{
    id?: string;
    client_business_id?: string;
  }>(`${graphFacebookBaseUrl}/${graphApiVersion}/me?${params.toString()}`);

  if (!data.id || !data.client_business_id) {
    throw new Error(
      "Token is not a Business Integration System User token (missing client_business_id)",
    );
  }

  return {
    id: String(data.id),
    clientBusinessId: String(data.client_business_id),
  };
}

async function getAssignedAdAccounts(
  bisuAppScopedId: string,
  accessToken: string,
): Promise<AssignedAdAccount[]> {
  const params = new URLSearchParams({
    fields: BISU_AD_ACCOUNT_FIELDS,
    limit: AD_ACCOUNTS_PAGE_LIMIT,
    access_token: accessToken,
  });
  appendAppSecretProof(params, accessToken);

  return paginateGraph<AssignedAdAccount>(
    `${graphFacebookBaseUrl}/${graphApiVersion}/${bisuAppScopedId}/assigned_ad_accounts?${params.toString()}`,
  );
}

async function getMeAdAccountsAsAssigned(
  accessToken: string,
): Promise<AssignedAdAccount[]> {
  const params = new URLSearchParams({
    fields: BISU_AD_ACCOUNT_FIELDS,
    limit: AD_ACCOUNTS_PAGE_LIMIT,
    access_token: accessToken,
  });
  appendAppSecretProof(params, accessToken);

  return paginateGraph<AssignedAdAccount>(
    `${graphFacebookBaseUrl}/${graphApiVersion}/me/adaccounts?${params.toString()}`,
  );
}

function mergeAssignedAdAccounts(
  ...lists: AssignedAdAccount[][]
): AssignedAdAccount[] {
  const byId = new Map<string, AssignedAdAccount>();
  for (const list of lists) {
    for (const account of list) {
      const key = account.id.startsWith("act_")
        ? account.id
        : `act_${account.account_id ?? account.id}`;
      const existing = byId.get(key);
      if (!existing) {
        byId.set(key, account);
        continue;
      }
      byId.set(key, {
        ...existing,
        ...account,
        business: account.business ?? existing.business,
        name: account.name ?? existing.name,
      });
    }
  }
  return [...byId.values()];
}

function assignedToFacebookAdAccounts(
  accounts: AssignedAdAccount[],
): FacebookAdAccountBasicInfo[] {
  return accounts.map((a) => ({
    id: a.id.startsWith("act_") ? a.id : `act_${a.account_id ?? a.id}`,
    account_id: a.account_id ?? a.id.replace(/^act_/, ""),
    name: a.name,
    account_status: a.account_status,
    currency: a.currency,
    business: a.business
      ? { id: a.business.id, name: a.business.name }
      : undefined,
  }));
}

/**
 * TTL do cache da listagem de contas. A resposta é a mesma para o painel
 * /marketing, os crons de negócio e o coletor, e o conjunto de contas de um
 * cliente muda em escala de dias — 5 minutos de frescor não têm efeito visível.
 * Reconectar o Facebook troca o token e, com ele, a chave do cache.
 */
const AD_ACCOUNTS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get user/connection identity and accessible ad accounts.
 *
 * - Legacy user tokens: /me + /me/adaccounts
 * - BISU tokens: identity + me/adaccounts + assigned_ad_accounts
 */
export async function getUserWithAdAccounts(
  accessToken: string,
  options?: GetUserWithAdAccountsOptions,
): Promise<FacebookUserWithAdAccountsResponse> {
  const cacheKey = [
    "adaccounts",
    tokenCacheId(accessToken),
    options?.tokenKind ?? "user",
    options?.bisuAppScopedId ?? "",
    options?.clientBusinessId ?? "",
    options?.connectionName ?? "",
  ].join(":");

  return cachedMetaRead({
    key: cacheKey,
    ttlMs: AD_ACCOUNTS_CACHE_TTL_MS,
    fetcher: () => fetchUserWithAdAccounts(accessToken, options),
  });
}

async function fetchUserWithAdAccounts(
  accessToken: string,
  options?: GetUserWithAdAccountsOptions,
): Promise<FacebookUserWithAdAccountsResponse> {
  if (options?.tokenKind === "bisu") {
    const identity =
      options.bisuAppScopedId && options.clientBusinessId
        ? {
            id: options.bisuAppScopedId,
            clientBusinessId: options.clientBusinessId,
          }
        : await getBisuIdentity(accessToken);

    const [assigned, mine] = await Promise.all([
      getAssignedAdAccounts(identity.id, accessToken).catch((error) => {
        console.warn("assigned_ad_accounts failed for BISU token", error);
        return [] as AssignedAdAccount[];
      }),
      getMeAdAccountsAsAssigned(accessToken).catch((error) => {
        console.warn("me/adaccounts failed for BISU token", error);
        return [] as AssignedAdAccount[];
      }),
    ]);

    return {
      id: identity.id,
      name: options.connectionName ?? undefined,
      client_business_id: identity.clientBusinessId,
      token_kind: "bisu",
      adaccounts: {
        data: assignedToFacebookAdAccounts(
          mergeAssignedAdAccounts(assigned, mine),
        ),
      },
    };
  }

  const [userProfile, adAccounts] = await Promise.all([
    getFacebookUserProfile(accessToken),
    getAdAccounts(accessToken),
  ]);

  return {
    ...userProfile,
    token_kind: "user",
    adaccounts: adAccounts,
  };
}

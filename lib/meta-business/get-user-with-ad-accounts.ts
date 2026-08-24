import { graphFacebookBaseUrl, graphApiVersion } from "./constant";
import { appSecretProof, facebookAppSecret } from "./appsecret-proof";
import { GraphApiError, parseGraphError } from "./error";
import { cachedMetaRead, tokenCacheId } from "./read-cache";
import type { MetaTokenKind } from "./connection-record";
import {
  assertDeadlineBudget,
  deadlineExceededFrom,
  isCollectionDeadlineExceeded,
  MIN_EXTERNAL_OPERATION_BUDGET_MS,
  type CollectionDeadline,
} from "@/lib/meta-tracking/collection-deadline";
import { logMetaCall } from "@/lib/observability/meta-logger";
import { getMetaLogContext } from "@/lib/observability/meta-log-context";
import { safeErrorSummary } from "@/lib/observability/meta-log-safety";

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
  /** Deadline absoluto dos jobs; chamadas interativas deixam ausente. */
  deadline?: CollectionDeadline;
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

/**
 * Campos do `/me/adaccounts` no caminho de token de USUÁRIO.
 *
 * `owner` e `business{id}` foram removidos em 2026-08-21: são campos de
 * Business Manager, e pedi-los com um token cujo app está sem Acesso Avançado a
 * `business_management` (o estado desde o incidente de 2026-08-12) faz a Meta
 * recusar a listagem INTEIRA com `(#200) Requires business_management
 * permission` — era isso que derrubava o /api/cron-job/meta-tracking/daily em
 * todos os 32 ticks do dia. Nenhum consumidor do backoffice lê esses dois
 * campos (`balance` sim — ad-account-money.ts — e fica).
 */
const AD_ACCOUNT_FIELDS = [
  "id",
  "account_id",
  "name",
  "account_status",
  "balance",
  "currency",
] as const;

// Sem `business{id,name}` pelo mesmo motivo acima: com o app degradado, o campo
// derruba também o fallback `/me/adaccounts` do caminho BISU — que hoje falha em
// silêncio (catch → lista vazia) e aparece como "cliente sem contas".
const BISU_AD_ACCOUNT_FIELDS = "id,account_id,name,account_status,currency";

const AD_ACCOUNTS_PAGE_LIMIT = "100";

function logDiscoveryFallback(edge: string, error: unknown): void {
  const context = getMetaLogContext();
  console.warn(
    JSON.stringify({
      evt: "meta_account_discovery_fallback",
      runId: context?.runId,
      correlationId: context?.correlationId,
      category: "degraded_component",
      operation: "list",
      entity: "adaccount",
      edge,
      error: safeErrorSummary(error),
    }),
  );
}

async function fetchGraphJson<T>(
  url: string,
  deadline?: CollectionDeadline,
): Promise<T> {
  assertDeadlineBudget(
    deadline,
    "descobrir contas na Graph API",
    MIN_EXTERNAL_OPERATION_BUDGET_MS,
  );
  const startedAt = Date.now();
  const parsedUrl = new URL(url);
  const endpoint = `${parsedUrl.origin}${parsedUrl.pathname}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: deadline?.signal });
  } catch (error) {
    const deadlineError = deadlineExceededFrom(
      deadline,
      "aguardar descoberta de contas na Graph API",
      error,
    );
    if (deadlineError) throw deadlineError;
    logMetaCall({
      phase: "error",
      method: "GET",
      endpoint,
      requestParams: parsedUrl.searchParams,
      durationMs: Date.now() - startedAt,
      errorData: {
        error: {
          message: error instanceof Error ? error.message : String(error),
          is_transient: true,
        },
      },
      category: "external_transient",
    });
    throw error;
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    const deadlineError = deadlineExceededFrom(
      deadline,
      "ler descoberta de contas da Graph API",
      error,
    );
    if (deadlineError) throw deadlineError;
    throw error;
  }

  if (!response.ok || data.error) {
    logMetaCall({
      phase: "error",
      method: "GET",
      endpoint,
      requestParams: parsedUrl.searchParams,
      httpStatus: response.status,
      durationMs: Date.now() - startedAt,
      errorData: data,
    });
    // Typed error carries code/error_subcode so callers can detect 190/460
    // (session invalidated — user must reconnect) and surface it precisely.
    throw new GraphApiError(parseGraphError(data));
  }

  return data as T;
}

async function paginateGraph<T>(
  initialUrl: string,
  deadline?: CollectionDeadline,
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
    }>(nextUrl, deadline);

    all.push(...(page.data ?? []));
    nextUrl = page.paging?.next ?? "";
  }

  return all;
}

async function getFacebookUserProfile(
  accessToken: string,
  deadline?: CollectionDeadline,
): Promise<FacebookUserBasicInfo> {
  const params = new URLSearchParams({
    fields: USER_FIELDS.join(","),
    access_token: accessToken,
  });
  appendAppSecretProof(params, accessToken);

  return fetchGraphJson<FacebookUserBasicInfo>(
    `${graphFacebookBaseUrl}/${graphApiVersion}/me?${params.toString()}`,
    deadline,
  );
}

async function getAdAccounts(
  accessToken: string,
  deadline?: CollectionDeadline,
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
    >(nextUrl, deadline);

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
  deadline?: CollectionDeadline,
): Promise<{ id: string; clientBusinessId: string }> {
  const params = new URLSearchParams({
    fields: "id,client_business_id",
    access_token: accessToken,
  });
  appendAppSecretProof(params, accessToken);

  const data = await fetchGraphJson<{
    id?: string;
    client_business_id?: string;
  }>(
    `${graphFacebookBaseUrl}/${graphApiVersion}/me?${params.toString()}`,
    deadline,
  );

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
  deadline?: CollectionDeadline,
): Promise<AssignedAdAccount[]> {
  const params = new URLSearchParams({
    fields: BISU_AD_ACCOUNT_FIELDS,
    limit: AD_ACCOUNTS_PAGE_LIMIT,
    access_token: accessToken,
  });
  appendAppSecretProof(params, accessToken);

  return paginateGraph<AssignedAdAccount>(
    `${graphFacebookBaseUrl}/${graphApiVersion}/${bisuAppScopedId}/assigned_ad_accounts?${params.toString()}`,
    deadline,
  );
}

async function getMeAdAccountsAsAssigned(
  accessToken: string,
  deadline?: CollectionDeadline,
): Promise<AssignedAdAccount[]> {
  const params = new URLSearchParams({
    fields: BISU_AD_ACCOUNT_FIELDS,
    limit: AD_ACCOUNTS_PAGE_LIMIT,
    access_token: accessToken,
  });
  appendAppSecretProof(params, accessToken);

  return paginateGraph<AssignedAdAccount>(
    `${graphFacebookBaseUrl}/${graphApiVersion}/me/adaccounts?${params.toString()}`,
    deadline,
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
  // Uma requisição abortável não compartilha `inflight` com telas ou outros
  // jobs: o deadline de um chamador não pode cancelar a descoberta dos demais.
  // O coletor chama isto uma vez por usuário e seu cron é mais espaçado que o
  // TTL, então o bypass não cria retry nem muda o volume normal entre ticks.
  if (options?.deadline) {
    return fetchUserWithAdAccounts(accessToken, options);
  }

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
        : await getBisuIdentity(accessToken, options.deadline);

    const [assigned, mine] = await Promise.all([
      getAssignedAdAccounts(identity.id, accessToken, options.deadline).catch(
        (error) => {
          if (isCollectionDeadlineExceeded(error)) throw error;
          logDiscoveryFallback("assigned_ad_accounts", error);
          return [] as AssignedAdAccount[];
        },
      ),
      getMeAdAccountsAsAssigned(accessToken, options.deadline).catch((error) => {
        if (isCollectionDeadlineExceeded(error)) throw error;
        logDiscoveryFallback("me/adaccounts", error);
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
    getFacebookUserProfile(accessToken, options?.deadline),
    getAdAccounts(accessToken, options?.deadline),
  ]);

  return {
    ...userProfile,
    token_kind: "user",
    adaccounts: adAccounts,
  };
}

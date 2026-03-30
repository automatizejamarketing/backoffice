import { graphFacebookBaseUrl, graphApiVersion } from "./constant";

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

const AD_ACCOUNTS_PAGE_LIMIT = "100";

async function fetchGraphJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.error) {
    const errorData = data as FacebookGraphApiError;
    console.error("Error fetching Facebook Graph data:", errorData);
    throw new Error(errorData.error?.message ?? "Failed to fetch Graph data");
  }

  return data as T;
}

async function getFacebookUserProfile(
  accessToken: string,
): Promise<FacebookUserBasicInfo> {
  const params = new URLSearchParams({
    fields: USER_FIELDS.join(","),
    access_token: accessToken,
  });

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

/**
 * Get user basic info and all accessible ad accounts.
 */
export async function getUserWithAdAccounts(
  accessToken: string
): Promise<FacebookUserWithAdAccountsResponse> {
  const [userProfile, adAccounts] = await Promise.all([
    getFacebookUserProfile(accessToken),
    getAdAccounts(accessToken),
  ]);

  return {
    ...userProfile,
    adaccounts: adAccounts,
  };
}

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

// User basic info fields to request
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

// Ad account basic info fields to request
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

/**
 * Get user basic info and ad accounts in a single Graph API request
 */
export async function getUserWithAdAccounts(
  accessToken: string
): Promise<FacebookUserWithAdAccountsResponse> {
  const adAccountsExpansion = `adaccounts{${AD_ACCOUNT_FIELDS.join(",")}}`;
  const fields = [...USER_FIELDS, adAccountsExpansion].join(",");

  const params = new URLSearchParams({
    fields,
    access_token: accessToken,
  });

  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/me?${params.toString()}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(
      data.error?.message ?? "Failed to get user with ad accounts"
    );
  }

  return data as FacebookUserWithAdAccountsResponse;
}

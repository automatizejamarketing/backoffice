import { graphFacebookBaseUrl, graphApiVersion } from "./constant";

/**
 * AdsPixel from Facebook Graph API
 */
export type FacebookAdsPixel = {
  id: string;
  name?: string;
  code?: string;
  creation_time?: string;
  creator?: {
    id: string;
    name?: string;
  };
  data_use_setting?: string;
  enable_auto_assign_to_accounts?: boolean;
  enable_automatic_matching?: boolean;
  first_party_cookie_status?: string;
  is_created_by_business?: boolean;
  is_crm?: boolean;
  is_mta_use?: boolean;
  is_unavailable?: boolean;
  last_fired_time?: string;
  owner_ad_account?: {
    id: string;
    name?: string;
  };
  owner_business?: {
    id: string;
    name?: string;
  };
};

/**
 * Response from fetching ads pixels
 */
export type FacebookAdsPixelsResponse = {
  data: FacebookAdsPixel[];
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

// Fields to request from the Graph API
const PIXEL_FIELDS = [
  "id",
  "name",
  "creation_time",
  // "creator",
  // "data_use_setting",
  // "enable_auto_assign_to_accounts",
  // "enable_automatic_matching",
  // "first_party_cookie_status",
  // "is_created_by_business",
  // "is_crm",
  // "is_mta_use",
  "is_unavailable",
  "last_fired_time",
  // "owner_ad_account",
  // "owner_business",
] as const;

/**
 * Get ads pixels for an ad account
 *
 * Fetches all ads pixels associated with a given ad account.
 * Pixels are used for conversion tracking on websites.
 *
 * @param adAccountId - The ad account ID (format: "act_123456789")
 * @param accessToken - The Facebook access token
 * @param fields - Optional array of fields to request. Defaults to common fields.
 * @returns Ads pixels response with data and pagination info
 * @throws Error if the API request fails
 *
 * @example
 * ```ts
 * const pixels = await getAdAccountPixels("act_123456789", accessToken);
 * console.log(pixels.data); // Array of pixels
 * console.log(pixels.data[0].id); // First pixel ID
 * ```
 */
export async function getAdAccountPixels(
  adAccountId: string,
  accessToken: string,
  fields?: readonly string[]
): Promise<FacebookAdsPixelsResponse> {
  // Use provided fields or default to common fields
  const requestedFields = fields ?? PIXEL_FIELDS;
  const fieldsParam = requestedFields.join(",");

  const params = new URLSearchParams({
    fields: fieldsParam,
    access_token: accessToken,
  });

  const url = `${graphFacebookBaseUrl}/${graphApiVersion}/${adAccountId}/adspixels?${params.toString()}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.error) {
    const errorData = data as FacebookGraphApiError;
    console.error("Error fetching ads pixels:", errorData);
    throw new Error(errorData.error?.message ?? "Failed to get ads pixels");
  }

  return data as FacebookAdsPixelsResponse;
}

/**
 * Get the first available pixel for an ad account
 *
 * Convenience method that returns the first non-unavailable pixel.
 *
 * @param adAccountId - The ad account ID (format: "act_123456789")
 * @param accessToken - The Facebook access token
 * @returns The first available pixel or null if none found
 *
 * @example
 * ```ts
 * const pixel = await getFirstAvailablePixel("act_123456789", accessToken);
 * if (pixel) {
 *   console.log(pixel.id); // Pixel ID for use in campaigns
 * }
 * ```
 */
export async function getFirstAvailablePixel(
  adAccountId: string,
  accessToken: string
): Promise<FacebookAdsPixel | null> {
  const response = await getAdAccountPixels(adAccountId, accessToken);

  // Find the first pixel that is not unavailable
  const availablePixel = response.data.find(
    (pixel) => pixel.is_unavailable !== true
  );

  return availablePixel ?? response.data[0] ?? null;
}

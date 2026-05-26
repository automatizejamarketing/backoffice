import { metaApiCall } from "@/lib/meta-business/api";
import {
  buildInterestValidationParams,
  getInvalidInterestIdsFromValidation,
  mapMetaInterestSearchResults,
  type MetaInterestSearchResponse,
} from "@/lib/meta-business/interest-search";

export async function validateInterestIdsWithMeta(
  accessToken: string,
  ids: string[],
  locale?: string,
): Promise<{ valid: boolean; invalidIds: string[] }> {
  if (ids.length === 0) {
    return { valid: true, invalidIds: [] };
  }

  const response = await metaApiCall<MetaInterestSearchResponse>({
    method: "GET",
    path: "search",
    params: buildInterestValidationParams({ ids, locale }),
    accessToken,
  });

  const results = mapMetaInterestSearchResults(response);
  const invalidIds = getInvalidInterestIdsFromValidation(results, ids);

  return { valid: invalidIds.length === 0, invalidIds };
}

export const INTEREST_VALIDATION_ERROR_MESSAGE =
  "Alguns interesses selecionados não estão mais disponíveis para segmentação. Remova-os e tente novamente.";

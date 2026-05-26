import { NextRequest, NextResponse } from "next/server";

import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import type { MetaInterestSearchResult } from "@/lib/meta-business/interest-targeting-types";
import { validateInterestIdsWithMeta } from "@/lib/meta-business/validate-interest-ids";
import {
  buildInterestValidationParams,
  mapMetaInterestSearchResults,
  type MetaInterestSearchResponse,
} from "@/lib/meta-business/interest-search";

type SuccessResponse = {
  data: MetaInterestSearchResult[];
  invalidIds: string[];
};
type ErrorResponse = { error: string; message: string; solution?: string };

export async function GET(
  request: NextRequest,
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId")?.trim() ?? "";
    const accountId = searchParams.get("accountId")?.trim() ?? "";
    const idsParam = searchParams.get("ids")?.trim() ?? "";

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

    if (!accountId) {
      return NextResponse.json(
        {
          error: "Missing account ID",
          message: "An ad account is required to validate interests",
          solution: "Select an ad account and try again",
        },
        { status: 400 },
      );
    }

    let ids: string[] = [];
    try {
      ids = JSON.parse(idsParam) as string[];
      if (!Array.isArray(ids)) ids = [];
    } catch {
      ids = idsParam ? [idsParam] : [];
    }

    if (ids.length === 0) {
      return NextResponse.json({ data: [], invalidIds: [] }, { status: 200 });
    }

    const tokenResult = await getUserAccessTokenByUserId(userId);
    if (!tokenResult.success) {
      return NextResponse.json(
        {
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
        },
        { status: tokenResult.error.statusCode },
      );
    }

    const locale = searchParams.get("locale")?.trim() ?? undefined;
    const response = await metaApiCall<MetaInterestSearchResponse>({
      method: "GET",
      path: "search",
      params: buildInterestValidationParams({ ids, locale }),
      accessToken: tokenResult.accessToken,
    });
    const data = mapMetaInterestSearchResults(response);
    const { invalidIds } = await validateInterestIdsWithMeta(
      tokenResult.accessToken,
      ids,
      locale,
    );

    return NextResponse.json({ data, invalidIds }, { status: 200 });
  } catch (error) {
    console.error("Error validating interests:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while validating interests",
        solution: "Please try again in a moment",
      },
      { status: 500 },
    );
  }
}

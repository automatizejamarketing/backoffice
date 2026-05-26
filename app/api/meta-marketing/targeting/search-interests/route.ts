import { NextRequest, NextResponse } from "next/server";

import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import type { MetaInterestSearchResult } from "@/lib/meta-business/interest-targeting-types";
import {
  buildInterestSearchParams,
  mapMetaInterestSearchResults,
  type MetaInterestSearchResponse,
} from "@/lib/meta-business/interest-search";

type SuccessResponse = { data: MetaInterestSearchResult[] };
type ErrorResponse = { error: string; message: string; solution?: string };

export async function GET(
  request: NextRequest,
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId")?.trim() ?? "";
    const q = searchParams.get("q")?.trim() ?? "";
    const accountId = searchParams.get("accountId")?.trim() ?? "";

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
          message: "An ad account is required to search for interests",
          solution: "Select an ad account and try again",
        },
        { status: 400 },
      );
    }

    if (!q) {
      return NextResponse.json({ data: [] }, { status: 200 });
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
      params: buildInterestSearchParams({ query: q, locale }),
      accessToken: tokenResult.accessToken,
    });

    return NextResponse.json(
      { data: mapMetaInterestSearchResults(response) },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error searching interests:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while searching interests",
        solution: "Please try again in a moment",
      },
      { status: 500 },
    );
  }
}

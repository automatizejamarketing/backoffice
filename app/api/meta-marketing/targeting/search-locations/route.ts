import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import type { GeoLocationSearchResult } from "@/lib/meta-business/geo-targeting-types";
import {
  buildAdsManagerGeoSearchParams,
  buildLegacyGeoSearchParams,
  mapMetaGeoSearchResults,
  type MetaTargetingSearchResponse,
} from "@/lib/meta-business/geo-location-search";

type SearchLocationsSuccessResponse = {
  data: GeoLocationSearchResult[];
};

type SearchLocationsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

function shouldFallbackToLegacyGeoSearch(error: unknown) {
  if (!(error instanceof GraphApiError)) {
    return false;
  }

  const graphCode = error.errorReturn.data?.code;
  return error.errorReturn.statusCode === 400 || graphCode === 100 || graphCode === 2500;
}

async function searchMetaLocations(
  accessToken: string,
  params: string,
): Promise<GeoLocationSearchResult[]> {
  const response = await metaApiCall<MetaTargetingSearchResponse>({
    method: "GET",
    path: "search",
    params,
    accessToken,
  });

  return mapMetaGeoSearchResults(response);
}

/**
 * GET /api/meta-marketing/targeting/search-locations
 *
 * Admin-only: search Meta ad locations using the target user's token.
 * Query: userId (required), accountId (required), q, locale.
 */
export async function GET(
  request: NextRequest,
): Promise<
  NextResponse<SearchLocationsSuccessResponse | SearchLocationsErrorResponse>
> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Not authenticated",
          message: "You must be logged in to access this resource",
          solution: "Please log in and try again",
        },
        { status: 401 },
      );
    }

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

    if (!accountId) {
      return NextResponse.json(
        {
          error: "Missing account ID",
          message: "An ad account is required to search for target locations",
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

    const { accessToken } = tokenResult;
    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    const locale = searchParams.get("locale")?.trim() ?? undefined;
    let data: GeoLocationSearchResult[];

    try {
      data = await searchMetaLocations(
        accessToken,
        buildAdsManagerGeoSearchParams({
          query: q,
          accountId: formattedAccountId,
          locale,
        }),
      );
    } catch (error) {
      if (!shouldFallbackToLegacyGeoSearch(error)) {
        throw error;
      }

      data = await searchMetaLocations(
        accessToken,
        buildLegacyGeoSearchParams({
          query: q,
        }),
      );
    }

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    console.error("Error searching target locations:", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while searching locations",
        solution: "Please try again in a moment",
      },
      { status: 500 },
    );
  }
}

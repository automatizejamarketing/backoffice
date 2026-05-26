import { NextRequest, NextResponse } from "next/server";

import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  mapGooglePlaceDetailsToGeoLocationSearchResult,
  type GooglePlaceDetailsResponse,
} from "@/lib/geo/google-places-location-search";
import type { GeoLocationSearchResult } from "@/lib/meta-business/geo-targeting-types";

type DetailsRequestBody = {
  placeId?: unknown;
  sessionToken?: unknown;
  userId?: unknown;
};

type DetailsResponse =
  | { location: GeoLocationSearchResult | null }
  | { error: string; message: string };

export async function POST(
  request: NextRequest,
): Promise<NextResponse<DetailsResponse>> {
  try {
    const body = (await request.json()) as DetailsRequestBody;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

    const placeId = typeof body.placeId === "string" ? body.placeId.trim() : "";
    const sessionToken =
      typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";

    if (!placeId || !sessionToken) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          message: "placeId and sessionToken are required",
        },
        { status: 400 },
      );
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      console.error("googlePlaces.details.missingApiKey");
      return NextResponse.json(
        {
          error: "Missing configuration",
          message: "Google Places API key is not configured",
        },
        { status: 500 },
      );
    }

    const url = new URL(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    );
    url.searchParams.set("sessionToken", sessionToken);
    url.searchParams.set("languageCode", "pt-BR");
    url.searchParams.set("regionCode", "BR");

    const response = await fetch(url.toString(), {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "id,location,formattedAddress,addressComponents,displayName,types",
      },
    });

    if (!response.ok) {
      throw new Error(`Google Places details failed (${response.status})`);
    }

    const location = mapGooglePlaceDetailsToGeoLocationSearchResult(
      (await response.json()) as GooglePlaceDetailsResponse,
    );

    return NextResponse.json({ location }, { status: 200 });
  } catch (error) {
    console.error("googlePlaces.details.error", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: "Unable to resolve coordinates for this address",
      },
      { status: 500 },
    );
  }
}

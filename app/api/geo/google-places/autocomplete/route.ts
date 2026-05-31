import { NextRequest, NextResponse } from "next/server";

import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  GOOGLE_PLACES_AUTOCOMPLETE_TYPE_GROUPS,
  mapGoogleAutocompleteResponse,
  resolveAutocompleteLocationBias,
  type GooglePlaceAutocompleteResult,
  type GooglePlacesAutocompleteResponse,
  type GooglePlacesCircleBias,
} from "@/lib/geo/google-places-location-search";

type AutocompleteRequestBody = {
  input?: unknown;
  sessionToken?: unknown;
  userId?: unknown;
  locationBias?: unknown;
};

type AutocompleteResponse =
  | { data: GooglePlaceAutocompleteResult[] }
  | { error: string; message: string };

function normalizeInput(input: unknown) {
  return typeof input === "string"
    ? input.trim().replace(/\s+/g, " ")
    : "";
}

async function fetchAutocompleteGroup(
  apiKey: string,
  input: string,
  sessionToken: string,
  includedPrimaryTypes: readonly string[],
  locationBias?: GooglePlacesCircleBias,
) {
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input,
      includedPrimaryTypes,
      includedRegionCodes: ["br"],
      languageCode: "pt-BR",
      regionCode: "BR",
      sessionToken,
      includeQueryPredictions: false,
      includePureServiceAreaBusinesses: false,
      // Optional soft bias toward an area; when absent the search stays
      // country-wide (Brazil). locationBias coexists with includedRegionCodes,
      // so biased results are still constrained to Brazil.
      ...(locationBias ? { locationBias } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Places autocomplete failed (${response.status})`);
  }

  return mapGoogleAutocompleteResponse(
    (await response.json()) as GooglePlacesAutocompleteResponse,
    { isBusiness: includedPrimaryTypes.includes("establishment") },
  );
}

function mergeResults(
  groups: Array<PromiseSettledResult<GooglePlaceAutocompleteResult[]>>,
) {
  const seen = new Set<string>();
  const data: GooglePlaceAutocompleteResult[] = [];

  for (const group of groups) {
    if (group.status === "rejected") {
      console.warn("googlePlaces.autocomplete.groupFailed", group.reason);
      continue;
    }

    for (const place of group.value) {
      if (seen.has(place.place_id)) {
        continue;
      }

      seen.add(place.place_id);
      data.push(place);
    }
  }

  return data;
}

function resolveRequestLocationBias(
  request: NextRequest,
  body: AutocompleteRequestBody,
): GooglePlacesCircleBias | undefined {
  // 1. Explicit bias from the client (e.g. the browser Geolocation API) wins.
  const explicit = resolveAutocompleteLocationBias(body.locationBias);
  if (explicit) {
    return explicit;
  }

  // 2. Fall back to Vercel's IP geolocation headers — no permission prompt,
  //    city-level accuracy, which is plenty for a soft bias. The headers are
  //    absent on localhost, so dev simply falls back to a Brazil-wide search.
  const latitude = Number.parseFloat(
    request.headers.get("x-vercel-ip-latitude") ?? "",
  );
  const longitude = Number.parseFloat(
    request.headers.get("x-vercel-ip-longitude") ?? "",
  );

  return resolveAutocompleteLocationBias({ latitude, longitude });
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<AutocompleteResponse>> {
  try {
    const body = (await request.json()) as AutocompleteRequestBody;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

    const input = normalizeInput(body.input);
    const sessionToken =
      typeof body.sessionToken === "string" ? body.sessionToken.trim() : "";

    if (input.length < 3) {
      return NextResponse.json({ data: [] }, { status: 200 });
    }

    if (!sessionToken) {
      return NextResponse.json(
        {
          error: "Missing session token",
          message: "A Google Places session token is required",
        },
        { status: 400 },
      );
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      console.error("googlePlaces.autocomplete.missingApiKey");
      return NextResponse.json(
        {
          error: "Missing configuration",
          message: "Google Places API key is not configured",
        },
        { status: 500 },
      );
    }

    const locationBias = resolveRequestLocationBias(request, body);

    const groups = await Promise.allSettled(
      GOOGLE_PLACES_AUTOCOMPLETE_TYPE_GROUPS.map((typeGroup) =>
        fetchAutocompleteGroup(
          apiKey,
          input,
          sessionToken,
          typeGroup,
          locationBias,
        ),
      ),
    );

    return NextResponse.json({ data: mergeResults(groups) }, { status: 200 });
  } catch (error) {
    console.error("googlePlaces.autocomplete.error", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: "Unable to search specific addresses right now",
      },
      { status: 500 },
    );
  }
}

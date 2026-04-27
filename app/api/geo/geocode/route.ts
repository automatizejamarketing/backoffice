import { NextRequest, NextResponse } from "next/server";

import { geocodeZipWithNominatimFallbacks } from "@/lib/geo/nominatim-zip-geocode";

/**
 * Approximate lat/lon for map UI (OpenStreetMap Nominatim).
 * Not used for Meta targeting; ZIP targeting still uses geo_locations.zips keys only.
 */
export async function GET(
  request: NextRequest,
): Promise<
  NextResponse<
    | { latitude: number; longitude: number; displayName?: string }
    | { error: string; message: string }
  >
> {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const countryCode = request.nextUrl.searchParams.get("countryCode")?.trim().toLowerCase();
  const postalcode = request.nextUrl.searchParams.get("postalcode")?.trim() || undefined;
  const key = request.nextUrl.searchParams.get("key")?.trim() || undefined;
  const city = request.nextUrl.searchParams.get("city")?.trim() || undefined;
  const region = request.nextUrl.searchParams.get("region")?.trim() || undefined;
  const countryName = request.nextUrl.searchParams.get("countryName")?.trim() || undefined;

  if (!q && !postalcode && !key) {
    return NextResponse.json(
      { error: "Missing query", message: "Provide q, postalcode, or key" },
      { status: 400 },
    );
  }

  try {
    const result = await geocodeZipWithNominatimFallbacks({
      q: q || [postalcode, city, region, countryName].filter(Boolean).join(", "),
      postalcode,
      key,
      countryCode: countryCode || undefined,
      city,
      region,
      countryName,
    });

    if (!result) {
      return NextResponse.json(
        {
          error: "Not found",
          message: "No coordinates for this query",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      latitude: result.latitude,
      longitude: result.longitude,
      displayName: result.displayName,
    });
  } catch (error) {
    console.error("Geocode error:", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message:
          error instanceof Error ? error.message : "Unexpected geocoding error",
      },
      { status: 500 },
    );
  }
}

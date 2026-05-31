"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounceValue } from "usehooks-ts";

import type {
  GeoLocationSearchResult,
  SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";

type SearchLocationsResponse = {
  data: GeoLocationSearchResult[];
};

type SearchLocationsError = {
  error: string;
  message: string;
  solution?: string;
};

type LocationBiasInput = {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
};

type UseLocationSearchParams = {
  accountId: string | null;
  userId?: string | null;
  locale?: string;
  searchTerm: string;
  placesSessionToken: string | null;
  selectedLocations: SelectedGeoLocation[];
  enabled?: boolean;
  /**
   * Optional soft bias toward an area (e.g. the browser's geolocation). When
   * omitted, the server falls back to Vercel IP geolocation, then to a
   * country-wide (Brazil) search.
   */
  locationBias?: LocationBiasInput | null;
};

type GooglePlacesAutocompleteResponse = {
  data: GeoLocationSearchResult[];
};

type GooglePlacesDetailsResponse = {
  location: GeoLocationSearchResult | null;
};

async function fetchMetaLocations(
  accountId: string,
  userId: string | undefined,
  locale: string | undefined,
  searchTerm: string,
): Promise<SearchLocationsResponse> {
  const params = new URLSearchParams({
    accountId,
    q: searchTerm,
  });

  if (userId) {
    params.set("userId", userId);
  }

  if (locale) {
    params.set("locale", locale);
  }

  const response = await fetch(
    `/api/meta-marketing/targeting/search-locations?${params.toString()}`,
  );

  if (!response.ok) {
    const errorData = (await response.json()) as SearchLocationsError;
    throw new Error(errorData.message ?? "Failed to search locations");
  }

  return (await response.json()) as SearchLocationsResponse;
}

async function fetchGooglePlacesAutocomplete(
  searchTerm: string,
  placesSessionToken: string | null,
  userId: string | undefined,
  locationBias?: LocationBiasInput | null,
): Promise<GooglePlacesAutocompleteResponse> {
  if (searchTerm.length < 3 || !placesSessionToken || !userId) {
    return { data: [] };
  }

  const response = await fetch("/api/geo/google-places/autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: searchTerm,
      sessionToken: placesSessionToken,
      userId,
      ...(locationBias ? { locationBias } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to search specific addresses");
  }

  return (await response.json()) as GooglePlacesAutocompleteResponse;
}

function mergeGeoLocationSearchResults(
  metaResults: GeoLocationSearchResult[],
  googleResults: GeoLocationSearchResult[],
) {
  const seen = new Set<string>();
  const merged: GeoLocationSearchResult[] = [];

  for (const location of [...metaResults, ...googleResults]) {
    const key = `${location.source ?? "meta"}:${location.key}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(location);
  }

  return merged;
}

async function fetchLocations(
  accountId: string,
  userId: string | undefined,
  locale: string | undefined,
  searchTerm: string,
  placesSessionToken: string | null,
  locationBias?: LocationBiasInput | null,
): Promise<SearchLocationsResponse> {
  const [metaResult, googleResult] = await Promise.allSettled([
    fetchMetaLocations(accountId, userId, locale, searchTerm),
    fetchGooglePlacesAutocomplete(
      searchTerm,
      placesSessionToken,
      userId,
      locationBias,
    ),
  ]);

  if (metaResult.status === "rejected") {
    throw metaResult.reason;
  }

  if (googleResult.status === "rejected") {
    console.warn("googlePlaces.autocomplete.clientFailed", googleResult.reason);
  }

  return {
    data: mergeGeoLocationSearchResults(
      metaResult.value.data,
      googleResult.status === "fulfilled" ? googleResult.value.data : [],
    ),
  };
}

export async function fetchGooglePlaceDetails({
  placeId,
  sessionToken,
  userId,
}: {
  placeId: string;
  sessionToken: string;
  userId?: string | null;
}): Promise<GeoLocationSearchResult | null> {
  const response = await fetch("/api/geo/google-places/details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placeId, sessionToken, userId }),
  });

  if (!response.ok) {
    throw new Error("Failed to resolve address coordinates");
  }

  const data = (await response.json()) as GooglePlacesDetailsResponse;
  return data.location;
}

export function useLocationSearch({
  accountId,
  userId,
  locale,
  searchTerm,
  placesSessionToken,
  selectedLocations,
  enabled = true,
  locationBias,
}: UseLocationSearchParams) {
  const [debouncedSearchTerm] = useDebounceValue(searchTerm, 400);
  const normalizedSearchTerm = debouncedSearchTerm.trim();

  const query = useQuery({
    queryKey: [
      "meta-location-search",
      accountId,
      userId,
      locale,
      normalizedSearchTerm,
      placesSessionToken,
      locationBias,
    ],
    queryFn: () => {
      if (!accountId) {
        throw new Error("Account ID is required");
      }

      return fetchLocations(
        accountId,
        userId ?? undefined,
        locale,
        normalizedSearchTerm,
        placesSessionToken,
        locationBias,
      );
    },
    enabled: enabled && Boolean(accountId) && Boolean(userId) && normalizedSearchTerm.length > 0,
    staleTime: 60_000,
  });

  const selectedKeys = useMemo(
    () => new Set(selectedLocations.map((location) => location.key)),
    [selectedLocations],
  );

  const results = useMemo(
    () =>
      (query.data?.data ?? []).filter((location) => !selectedKeys.has(location.key)),
    [query.data?.data, selectedKeys],
  );

  return {
    ...query,
    debouncedSearchTerm: normalizedSearchTerm,
    results,
  };
}

export type { SearchLocationsResponse };

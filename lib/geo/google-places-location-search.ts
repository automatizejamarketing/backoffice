import {
  DEFAULT_CITY_RADIUS_KM,
  type GeoLocationSearchResult,
} from "@/lib/meta-business/geo-targeting-types";

export const GOOGLE_PLACES_AUTOCOMPLETE_TYPE_GROUPS = [
  ["street_address", "route", "neighborhood", "sublocality", "postal_code"],
  ["premise"],
  ["establishment"],
] as const;

/**
 * Default radius (meters) applied when an autocomplete request supplies a
 * location-bias center without an explicit radius. A soft bias only needs a
 * rough area, so a city-sized radius is enough.
 */
export const DEFAULT_AUTOCOMPLETE_BIAS_RADIUS_METERS = 20_000;
const MAX_AUTOCOMPLETE_BIAS_RADIUS_METERS = 50_000;

/** Circle location bias accepted by the Places Autocomplete (New) API. */
export type GooglePlacesCircleBias = {
  circle: {
    center: { latitude: number; longitude: number };
    radius: number;
  };
};

/** Raw center a caller can provide to bias autocomplete results. */
export type GooglePlacesAutocompleteBiasInput = {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
};

/**
 * Validates an untrusted location-bias payload (from the request body or from
 * Vercel IP headers) and turns it into a circle bias. Returns `undefined` when
 * the input is missing or invalid — in that case the caller should run a
 * country-wide (Brazil) autocomplete with no bias.
 */
export function resolveAutocompleteLocationBias(
  value: unknown,
): GooglePlacesCircleBias | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const { latitude, longitude } = candidate;

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return undefined;
  }

  const requestedRadius = candidate.radiusMeters;
  const radius =
    typeof requestedRadius === "number" &&
    Number.isFinite(requestedRadius) &&
    requestedRadius > 0
      ? Math.min(requestedRadius, MAX_AUTOCOMPLETE_BIAS_RADIUS_METERS)
      : DEFAULT_AUTOCOMPLETE_BIAS_RADIUS_METERS;

  return { circle: { center: { latitude, longitude }, radius } };
}

export type GooglePlacesSource = "google_places";

export type GooglePlaceAutocompleteResult = GeoLocationSearchResult & {
  source: GooglePlacesSource;
  place_id: string;
  requires_details: true;
};

export type GooglePlacesAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
};

export type GooglePlaceDetailsResponse = {
  id?: string;
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
  displayName?: {
    text?: string;
  };
  types?: string[];
};

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasType(component: { types?: string[] }, type: string) {
  return component.types?.includes(type) ?? false;
}

function getAddressComponent(
  components: GooglePlaceDetailsResponse["addressComponents"],
  type: string,
  preferShortText = false,
): string | undefined {
  const component = components?.find((item) => hasType(item, type));
  return normalizeText(
    preferShortText ? component?.shortText ?? component?.longText : component?.longText,
  );
}

function getRadiusForTypes(types: string[] | undefined) {
  const placeTypes = new Set(types ?? []);

  if (placeTypes.has("street_address") || placeTypes.has("premise")) {
    return 1;
  }

  if (
    placeTypes.has("route") ||
    placeTypes.has("neighborhood") ||
    placeTypes.has("sublocality")
  ) {
    return 2;
  }

  if (placeTypes.has("postal_code")) {
    return 3;
  }

  return DEFAULT_CITY_RADIUS_KM;
}

function buildAddressString(data: GooglePlaceDetailsResponse) {
  const components = data.addressComponents;
  const route = getAddressComponent(components, "route");
  const streetNumber = getAddressComponent(components, "street_number");
  const neighborhood =
    getAddressComponent(components, "neighborhood") ??
    getAddressComponent(components, "sublocality") ??
    getAddressComponent(components, "sublocality_level_1");
  const city =
    getAddressComponent(components, "locality") ??
    getAddressComponent(components, "administrative_area_level_2");
  const state = getAddressComponent(
    components,
    "administrative_area_level_1",
    true,
  );
  const country = getAddressComponent(components, "country");

  const street = route
    ? [streetNumber, route].filter(Boolean).join(" ")
    : undefined;

  return [street, neighborhood, city, state, country]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

export function mapGoogleAutocompleteResponse(
  response: GooglePlacesAutocompleteResponse,
  options?: { isBusiness?: boolean },
): GooglePlaceAutocompleteResult[] {
  const seen = new Set<string>();
  const results: GooglePlaceAutocompleteResult[] = [];

  for (const suggestion of response.suggestions ?? []) {
    const prediction = suggestion.placePrediction;
    const placeId = normalizeText(prediction?.placeId);
    const displayText = normalizeText(prediction?.text?.text);
    const mainText =
      normalizeText(prediction?.structuredFormat?.mainText?.text) ?? displayText;

    if (!placeId || !displayText || !mainText || seen.has(placeId)) {
      continue;
    }

    seen.add(placeId);
    results.push({
      key: `google:${placeId}`,
      name: mainText,
      type: "custom_location",
      source: "google_places",
      place_id: placeId,
      requires_details: true,
      is_business: options?.isBusiness ?? false,
      address_string: displayText,
      country_code: "BR",
      country_name: "Brasil",
    });
  }

  return results;
}

export function mapGooglePlaceDetailsToGeoLocationSearchResult(
  data: GooglePlaceDetailsResponse,
): GeoLocationSearchResult | null {
  const latitude = data.location?.latitude;
  const longitude = data.location?.longitude;

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }

  const placeId = normalizeText(data.id);
  const addressString = normalizeText(buildAddressString(data));
  const name =
    normalizeText(data.displayName?.text) ??
    normalizeText(data.formattedAddress) ??
    addressString;

  if (!placeId || !name || !addressString) {
    return null;
  }

  const countryCode = getAddressComponent(data.addressComponents, "country", true);
  const countryName = getAddressComponent(data.addressComponents, "country");
  const state = getAddressComponent(
    data.addressComponents,
    "administrative_area_level_1",
    true,
  );
  const city =
    getAddressComponent(data.addressComponents, "locality") ??
    getAddressComponent(data.addressComponents, "administrative_area_level_2");

  return {
    key: `google:${placeId}`,
    name,
    type: "custom_location",
    source: "google_places",
    place_id: placeId,
    address_string: addressString,
    latitude,
    longitude,
    radius: getRadiusForTypes(data.types),
    distance_unit: "kilometer",
    country_code: countryCode?.toUpperCase() === "BR" ? "BR" : countryCode,
    country_name: countryCode?.toUpperCase() === "BR" ? "Brasil" : countryName,
    region: state,
    primary_city: city,
  };
}

import type {
  GeoLocationSearchResult,
  GeoLocationType,
} from "./geo-targeting-types";

export type MetaTargetingSearchResponse = {
  data?: Array<Record<string, unknown>>;
};

const SUPPORTED_LOCATION_TYPES = new Set([
  "country",
  "country_group",
  "region",
  "city",
  "subcity",
  "neighborhood",
  "zip",
  "geo_market",
  "electoral_district",
  "place",
]);

const LEGACY_LOCATION_TYPES = [
  "country",
  "country_group",
  "region",
  "city",
  "subcity",
  "neighborhood",
  "zip",
  "geo_market",
  "electoral_district",
] as const;

type BuildGeoSearchParamsArgs = {
  query: string;
  accountId: string;
  locale?: string;
};

function getNestedRecord(
  value: unknown,
): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeAccountId(accountId: string) {
  return accountId.startsWith("act_") ? accountId.slice(4) : accountId;
}

export function normalizeMetaLocale(locale?: string) {
  if (!locale) {
    return "pt_BR";
  }

  if (locale.includes("-")) {
    const [language, region] = locale.split("-");
    if (language && region) {
      return `${language.toLowerCase()}_${region.toUpperCase()}`;
    }
  }

  return locale;
}

function buildAddressString(location: Record<string, unknown>): string | undefined {
  const nestedLocation = getNestedRecord(location.location);

  const street =
    getString(location.street) ??
    getString(nestedLocation?.street);
  const city =
    getString(location.city) ??
    getString(location.primary_city) ??
    getString(nestedLocation?.city) ??
    getString(nestedLocation?.primary_city);
  const state =
    getString(location.state) ??
    getString(location.region) ??
    getString(nestedLocation?.state) ??
    getString(nestedLocation?.region);
  const country =
    getString(location.country_name) ??
    getString(location.country) ??
    getString(nestedLocation?.country_name) ??
    getString(nestedLocation?.country);

  return [street, city, state, country].filter(Boolean).join(", ") || undefined;
}

function toCustomLocationResult(
  location: Record<string, unknown>,
): GeoLocationSearchResult | null {
  const nestedLocation = getNestedRecord(location.location);
  const key =
    getString(location.key) ??
    getString(location.id) ??
    getString(location.place_id) ??
    null;
  const name =
    getString(location.name) ??
    getString(location.title) ??
    getString(nestedLocation?.street) ??
    null;
  const addressString =
    getString(location.address_string) ??
    name ??
    buildAddressString(location) ??
    undefined;
  const latitude =
    getNumber(location.latitude) ?? getNumber(nestedLocation?.latitude);
  const longitude =
    getNumber(location.longitude) ?? getNumber(nestedLocation?.longitude);

  if (!key || !name || (!addressString && (latitude === undefined || longitude === undefined))) {
    return null;
  }

  return {
    key,
    name,
    type:
      getString(location.type) === "place"
        ? "place"
        : "custom_location",
    address_string: addressString,
    latitude,
    longitude,
    country_code:
      getString(location.country_code) ?? getString(nestedLocation?.country_code),
    country_name:
      getString(location.country_name) ??
      getString(nestedLocation?.country_name) ??
      getString(nestedLocation?.country),
    region:
      getString(location.region) ??
      getString(location.state) ??
      getString(nestedLocation?.state) ??
      getString(nestedLocation?.region),
    region_id:
      getNumber(location.region_id) ?? getNumber(nestedLocation?.region_id),
    primary_city:
      getString(location.primary_city) ??
      getString(location.city) ??
      getString(nestedLocation?.primary_city) ??
      getString(nestedLocation?.city),
    primary_city_id:
      getNumber(location.primary_city_id) ??
      getNumber(nestedLocation?.primary_city_id),
    supports_region:
      getBoolean(location.supports_region) ??
      getBoolean(nestedLocation?.supports_region),
    supports_city:
      getBoolean(location.supports_city) ??
      getBoolean(nestedLocation?.supports_city),
    geo_hierarchy_level:
      getString(location.geo_hierarchy_level) ??
      getString(nestedLocation?.geo_hierarchy_level),
    geo_hierarchy_name:
      getString(location.geo_hierarchy_name) ??
      getString(location.category) ??
      getString(location.category_name) ??
      getString(location.type_label),
  };
}

function toSearchResult(
  location: Record<string, unknown>,
): GeoLocationSearchResult | null {
  const type = getString(location.type) ?? null;
  const key = getString(location.key) ?? null;
  const name = getString(location.name) ?? null;

  if (!type || !key || !name) {
    return toCustomLocationResult(location);
  }

  if (!SUPPORTED_LOCATION_TYPES.has(type)) {
    return toCustomLocationResult(location);
  }

  const nestedLocation = getNestedRecord(location.location);

  return {
    key,
    name,
    type: type as GeoLocationType,
    country_code:
      getString(location.country_code),
    country_name:
      getString(location.country_name),
    region: getString(location.region),
    region_id: getNumber(location.region_id),
    primary_city: getString(location.primary_city),
    primary_city_id: getNumber(location.primary_city_id),
    supports_region: getBoolean(location.supports_region),
    supports_city: getBoolean(location.supports_city),
    geo_hierarchy_level: getString(location.geo_hierarchy_level),
    geo_hierarchy_name: getString(location.geo_hierarchy_name),
    address_string:
      getString(location.address_string) ?? buildAddressString(location),
    latitude:
      getNumber(location.latitude) ?? getNumber(nestedLocation?.latitude),
    longitude:
      getNumber(location.longitude) ?? getNumber(nestedLocation?.longitude),
  };
}

export function mapMetaGeoSearchResults(
  response: MetaTargetingSearchResponse,
): GeoLocationSearchResult[] {
  if (!Array.isArray(response.data)) {
    return [];
  }

  return response.data
    .map((location) => toSearchResult(location))
    .filter((location): location is GeoLocationSearchResult => location !== null);
}

export function buildAdsManagerGeoSearchParams({
  query,
  accountId,
  locale,
}: BuildGeoSearchParamsArgs) {
  const params = new URLSearchParams({
    type: "adgeolocation",
    ad_account_id: normalizeAccountId(accountId),
    qs: JSON.stringify([query]),
    limit: "10",
    locale: normalizeMetaLocale(locale),
    place_fallback: "true",
  });

  return params.toString();
}

export function buildLegacyGeoSearchParams({
  query,
}: Pick<BuildGeoSearchParamsArgs, "query">) {
  const params = new URLSearchParams({
    type: "adgeolocation",
    q: query,
    location_types: JSON.stringify(LEGACY_LOCATION_TYPES),
    limit: "15",
    place_fallback: "true",
  });

  return params.toString();
}

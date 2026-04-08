export const DEFAULT_CITY_RADIUS_KM = 16;
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 80;

export type GeoLocationType =
  | "country"
  | "country_group"
  | "region"
  | "city"
  | "subcity"
  | "neighborhood"
  | "zip"
  | "geo_market"
  | "electoral_district"
  | "place"
  | "custom_location";

export type GeoLocationSearchResult = {
  key: string;
  name: string;
  type: GeoLocationType;
  country_code?: string;
  country_name?: string;
  region?: string;
  region_id?: number;
  primary_city?: string;
  primary_city_id?: number;
  supports_region?: boolean;
  supports_city?: boolean;
  geo_hierarchy_level?: string;
  geo_hierarchy_name?: string;
  address_string?: string;
  latitude?: number;
  longitude?: number;
};

export type DistanceUnit = "kilometer" | "mile";

export type SelectedGeoLocation = {
  key: string;
  name: string;
  type: GeoLocationType;
  country_code?: string;
  country_name?: string;
  region?: string;
  region_id?: number;
  primary_city?: string;
  primary_city_id?: number;
  geo_hierarchy_level?: string;
  geo_hierarchy_name?: string;
  address_string?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  distance_unit?: DistanceUnit;
};

export type GeoLocationsPayload = {
  countries?: string[];
  country_groups?: string[];
  regions?: Array<{ key: string }>;
  cities?: Array<{
    key: string;
    radius?: number;
    distance_unit?: DistanceUnit;
  }>;
  zips?: Array<{ key: string }>;
  geo_markets?: Array<{ key: string }>;
  electoral_districts?: Array<{ key: string }>;
  custom_locations?: Array<{
    address_string: string;
    name?: string;
    latitude?: number;
    longitude?: number;
    radius?: number;
    distance_unit?: DistanceUnit;
  }>;
};

export const DEFAULT_BRAZIL_LOCATION: SelectedGeoLocation = {
  key: "BR",
  name: "Brazil",
  type: "country",
  country_code: "BR",
  country_name: "Brazil",
};

export function isCityLikeGeoLocation(
  location: Pick<SelectedGeoLocation, "type">,
): boolean {
  return (
    location.type === "custom_location" ||
    location.type === "place" ||
    location.type === "city" ||
    location.type === "subcity" ||
    location.type === "neighborhood"
  );
}

export function hasLocationCoordinates(
  location: Pick<SelectedGeoLocation, "latitude" | "longitude">,
): location is Pick<SelectedGeoLocation, "latitude" | "longitude"> & {
  latitude: number;
  longitude: number;
} {
  return (
    typeof location.latitude === "number" &&
    Number.isFinite(location.latitude) &&
    typeof location.longitude === "number" &&
    Number.isFinite(location.longitude)
  );
}

function clampRadius(radius: number) {
  return Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, radius));
}

export function normalizeSelectedGeoLocation(
  location: GeoLocationSearchResult | SelectedGeoLocation,
): SelectedGeoLocation {
  const radius = "radius" in location ? location.radius : undefined;
  const distanceUnit =
    "distance_unit" in location ? location.distance_unit : undefined;

  if (location.type === "custom_location") {
    return {
      ...location,
      radius: radius ?? DEFAULT_CITY_RADIUS_KM,
      distance_unit: distanceUnit ?? "kilometer",
    };
  }

  return {
    ...location,
    radius: undefined,
    distance_unit: undefined,
  };
}

export function buildGeoLocationsPayload(
  locations: SelectedGeoLocation[],
): GeoLocationsPayload | undefined {
  if (locations.length === 0) {
    return undefined;
  }

  const payload: GeoLocationsPayload = {};

  for (const location of locations) {
    if (location.type === "country" && location.key) {
      payload.countries ??= [];
      if (!payload.countries.includes(location.key)) {
        payload.countries.push(location.key);
      }
      continue;
    }

    if (location.type === "country_group" && location.key) {
      payload.country_groups ??= [];
      if (!payload.country_groups.includes(location.key)) {
        payload.country_groups.push(location.key);
      }
      continue;
    }

    if (location.type === "region" && location.key) {
      payload.regions ??= [];
      if (!payload.regions.some((region) => region.key === location.key)) {
        payload.regions.push({ key: location.key });
      }
      continue;
    }

    if (location.type === "zip" && location.key) {
      payload.zips ??= [];
      if (!payload.zips.some((zip) => zip.key === location.key)) {
        payload.zips.push({ key: location.key });
      }
      continue;
    }

    if (location.type === "geo_market" && location.key) {
      payload.geo_markets ??= [];
      if (!payload.geo_markets.some((geoMarket) => geoMarket.key === location.key)) {
        payload.geo_markets.push({ key: location.key });
      }
      continue;
    }

    if (location.type === "electoral_district" && location.key) {
      payload.electoral_districts ??= [];
      if (
        !payload.electoral_districts.some((district) => district.key === location.key)
      ) {
        payload.electoral_districts.push({ key: location.key });
      }
      continue;
    }

    if (
      (location.type === "custom_location" || location.type === "place") &&
      (location.address_string ||
        (typeof location.latitude === "number" &&
          typeof location.longitude === "number"))
    ) {
      payload.custom_locations ??= [];
      if (
        !payload.custom_locations.some(
          (customLocation) =>
            customLocation.address_string === location.address_string &&
            customLocation.latitude === location.latitude &&
            customLocation.longitude === location.longitude,
        )
      ) {
        payload.custom_locations.push({
          address_string: location.address_string ?? location.name,
          name: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
          radius: clampRadius(location.radius ?? DEFAULT_CITY_RADIUS_KM),
          distance_unit: location.distance_unit ?? "kilometer",
        });
      }
      continue;
    }

    if (isCityLikeGeoLocation(location) && location.key) {
      payload.cities ??= [];
      if (!payload.cities.some((city) => city.key === location.key)) {
        payload.cities.push({
          key: location.key,
          radius: clampRadius(location.radius ?? DEFAULT_CITY_RADIUS_KM),
          distance_unit: location.distance_unit ?? "kilometer",
        });
      }
    }
  }

  return payload;
}

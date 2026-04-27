import type { AdSetTargeting } from "./types";

type GeoLocations = NonNullable<AdSetTargeting["geo_locations"]>;

const GEO_LOCATION_COLLECTION_KEYS = [
  "countries",
  "country_groups",
  "cities",
  "regions",
  "zips",
  "geo_markets",
  "electoral_districts",
  "custom_locations",
  "location_types",
] as const satisfies ReadonlyArray<keyof GeoLocations>;

function hasItems(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

export function hasConfiguredGeoLocations(geoLocations?: GeoLocations | null) {
  if (!geoLocations) {
    return false;
  }

  return GEO_LOCATION_COLLECTION_KEYS.some((key) => hasItems(geoLocations[key]));
}

export function sanitizeGeoLocationsForMeta(
  geoLocations?: GeoLocations | null,
): GeoLocations | undefined {
  if (!geoLocations) {
    return undefined;
  }

  const cleanGeo: GeoLocations = {};

  if (hasItems(geoLocations.countries)) cleanGeo.countries = geoLocations.countries;
  if (hasItems(geoLocations.country_groups))
    cleanGeo.country_groups = geoLocations.country_groups;
  if (hasItems(geoLocations.cities)) cleanGeo.cities = geoLocations.cities;
  if (hasItems(geoLocations.regions)) cleanGeo.regions = geoLocations.regions;
  if (hasItems(geoLocations.zips)) cleanGeo.zips = geoLocations.zips;
  if (hasItems(geoLocations.geo_markets))
    cleanGeo.geo_markets = geoLocations.geo_markets;
  if (hasItems(geoLocations.electoral_districts))
    cleanGeo.electoral_districts = geoLocations.electoral_districts;
  if (hasItems(geoLocations.custom_locations))
    cleanGeo.custom_locations = geoLocations.custom_locations;
  if (hasItems(geoLocations.location_types))
    cleanGeo.location_types = geoLocations.location_types;

  return hasConfiguredGeoLocations(cleanGeo) ? cleanGeo : undefined;
}

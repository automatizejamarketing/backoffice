import type { SelectedGeoLocation } from "@/lib/meta-business/geo-targeting-types";

/** Meta often returns region labels like "Rio de Janeiro (state)" which confuse geocoders */
function sanitizeRegionLabel(region: string): string {
  return region
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds a single-line query for Nominatim from a Meta ZIP search result.
 */
export function buildZipGeocodeQuery(location: SelectedGeoLocation): string {
  const parts = [
    location.name,
    location.primary_city,
    location.region ? sanitizeRegionLabel(location.region) : undefined,
    location.country_name,
  ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);

  return parts.join(", ");
}

/**
 * Builds a Nominatim query for non-zip location types (city, subcity, neighborhood, place).
 * Uses name + region + country for best results.
 */
export function buildLocationGeocodeQuery(location: SelectedGeoLocation): string {
  const parts = [
    location.name,
    location.region ? sanitizeRegionLabel(location.region) : undefined,
    location.country_name,
  ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);

  return parts.join(", ");
}

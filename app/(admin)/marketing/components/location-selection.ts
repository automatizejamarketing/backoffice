import {
  DEFAULT_CITY_RADIUS_KM,
  applyDefaultBrazilLocationRule,
  isRadiusGeoLocation,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";

/** Inclusive radius range, in km, the location editor accepts. */
export type RadiusBounds = { min: number; max: number };

function clampRadius(value: number, bounds: RadiusBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/**
 * Appends an already-normalized location. Same Brazil rule as the customer app: the country
 * default leaves the list as soon as a specific place is in it.
 */
export function addSelectedLocation(
  locations: SelectedGeoLocation[],
  location: SelectedGeoLocation,
): SelectedGeoLocation[] {
  return applyDefaultBrazilLocationRule([...locations, location]);
}

/** Removes by key. Removing the last specific place brings the Brazil default back. */
export function removeSelectedLocation(
  locations: SelectedGeoLocation[],
  key: string,
): { locations: SelectedGeoLocation[]; removedIndex: number } {
  return {
    locations: applyDefaultBrazilLocationRule(
      locations.filter((location) => location.key !== key),
    ),
    removedIndex: locations.findIndex((location) => location.key === key),
  };
}

/** The removed card collapses; cards after it shift up one position. */
export function expandedIndexAfterRemoval(
  current: number | null,
  removedIndex: number,
): number | null {
  if (current === null || removedIndex < 0) return current;
  if (removedIndex === current) return null;
  return removedIndex < current ? current - 1 : current;
}

/**
 * Radius typed in the input or picked on the slider. Only address/place locations carry a radius
 * (Meta resolves the boundary of keyed ones); empty, zero, negative or non-numeric input is ignored.
 */
export function setLocationRadius(
  locations: SelectedGeoLocation[],
  key: string,
  rawValue: string,
  bounds: RadiusBounds,
): SelectedGeoLocation[] {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return locations;

  return locations.map((location) =>
    location.key === key && isRadiusGeoLocation(location)
      ? { ...location, radius: clampRadius(parsed, bounds), distance_unit: "kilometer" as const }
      : location,
  );
}

/** The ± buttons: one km at a time, starting from the default when no radius was set yet. */
export function stepLocationRadius(
  locations: SelectedGeoLocation[],
  key: string,
  delta: number,
  bounds: RadiusBounds,
): SelectedGeoLocation[] {
  return locations.map((location) =>
    location.key === key && isRadiusGeoLocation(location)
      ? {
          ...location,
          radius: clampRadius((location.radius ?? DEFAULT_CITY_RADIUS_KM) + delta, bounds),
          distance_unit: "kilometer" as const,
        }
      : location,
  );
}

/**
 * Dragging the map pin turns the location into a custom address at the new point, keeping its
 * radius (or the default one). The key changes, so later radius edits must use the new key.
 */
export function moveLocationPin(
  locations: SelectedGeoLocation[],
  index: number,
  latitude: number,
  longitude: number,
  bounds: RadiusBounds,
): SelectedGeoLocation[] {
  const key = `custom_${latitude.toFixed(6)}_${longitude.toFixed(6)}`;

  return locations.map((location, position) =>
    position === index
      ? {
          ...location,
          key,
          type: "custom_location" as const,
          latitude,
          longitude,
          address_string: location.address_string ?? location.name,
          radius: location.radius ?? clampRadius(DEFAULT_CITY_RADIUS_KM, bounds),
          distance_unit: "kilometer" as const,
        }
      : location,
  );
}

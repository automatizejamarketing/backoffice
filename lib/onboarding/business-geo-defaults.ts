import {
  DEFAULT_BRAZIL_LOCATION,
  DEFAULT_CITY_RADIUS_KM,
  hasLocationCoordinates,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";

export type BusinessAddress = {
  formatted: string;
  street?: string;
  streetNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
};

export type CompanyGeoInput = {
  id?: string;
  name?: string | null;
  googlePlaceId?: string | null;
  businessAddress?: BusinessAddress | Record<string, unknown> | unknown | null;
};

export type CompanyLocationGeoInput = {
  id?: string;
  name?: string | null;
  googlePlaceId?: string | null;
  businessAddress?: BusinessAddress | Record<string, unknown> | unknown | null;
};

export function parseBusinessAddress(
  value: CompanyGeoInput["businessAddress"] | null | undefined,
): BusinessAddress | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const formatted =
    typeof (value as BusinessAddress).formatted === "string"
      ? (value as BusinessAddress).formatted.trim()
      : "";
  if (!formatted) {
    return null;
  }
  return value as BusinessAddress;
}

function locationToSelectedGeo(
  location: CompanyLocationGeoInput,
  fallbackName: string,
): SelectedGeoLocation | null {
  const address = parseBusinessAddress(location.businessAddress);
  const lat = address?.latitude;
  const lng = address?.longitude;

  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    typeof lng !== "number" ||
    !Number.isFinite(lng) ||
    !address?.formatted
  ) {
    return null;
  }

  const name = location.name?.trim() || fallbackName || address.formatted;

  return {
    key: location.googlePlaceId
      ? `google:${location.googlePlaceId}`
      : `business:${location.id ?? `${lat},${lng}`}`,
    name,
    type: "custom_location",
    address_string: address.formatted,
    latitude: lat,
    longitude: lng,
    radius: DEFAULT_CITY_RADIUS_KM,
    distance_unit: "kilometer",
    country_code: "BR",
    country_name: "Brasil",
    region: address.state,
    primary_city: address.city,
  };
}

export function buildBusinessUnitSelectedLocations(
  company: CompanyGeoInput | null,
  locations: CompanyLocationGeoInput[] = [],
): SelectedGeoLocation[] {
  const units =
    locations.length > 0
      ? locations
      : company
        ? [
            {
              id: company.id,
              name: company.name,
              googlePlaceId: company.googlePlaceId,
              businessAddress: company.businessAddress,
            },
          ]
        : [];

  const mapped = units
    .map((unit) =>
      locationToSelectedGeo(unit, company?.name?.trim() || unit.name || ""),
    )
    .filter((location): location is SelectedGeoLocation => Boolean(location));

  return mapped.length > 0 ? mapped : [DEFAULT_BRAZIL_LOCATION];
}

/**
 * Addresses the business already saved. Country fallback is dropped so the
 * Inhar flow never pretends Brazil-wide targeting was a saved unit.
 */
export function buildSavedCustomLocations(
  company: CompanyGeoInput | null,
  locations: CompanyLocationGeoInput[] = [],
): SelectedGeoLocation[] {
  return buildBusinessUnitSelectedLocations(company, locations).filter(
    (location) => location.type === "custom_location",
  );
}

const GEO_COORDINATE_EPSILON = 0.0001;

function isSameGeoTarget(
  unit: SelectedGeoLocation,
  selected: SelectedGeoLocation,
): boolean {
  if (unit.key === selected.key) {
    return true;
  }

  if (
    unit.type === "custom_location" &&
    selected.type === "custom_location" &&
    hasLocationCoordinates(unit) &&
    hasLocationCoordinates(selected)
  ) {
    return (
      Math.abs(unit.latitude - selected.latitude) < GEO_COORDINATE_EPSILON &&
      Math.abs(unit.longitude - selected.longitude) < GEO_COORDINATE_EPSILON
    );
  }

  return false;
}

export function companyHasGeoDefault(
  company: CompanyGeoInput | null,
  locations: CompanyLocationGeoInput[] = [],
): boolean {
  if (locations.length > 0) {
    return locations.some((location) =>
      Boolean(locationToSelectedGeo(location, company?.name?.trim() || "")),
    );
  }

  const address = company ? parseBusinessAddress(company.businessAddress) : null;
  const lat = address?.latitude;
  const lng = address?.longitude;
  return (
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    Boolean(address?.formatted)
  );
}

/** True when every geo-targetable business unit is already in the selection. */
export function areBusinessUnitLocationsIncludedInSelection(
  company: CompanyGeoInput | null,
  locations: CompanyLocationGeoInput[] = [],
  selectedLocations: SelectedGeoLocation[] = [],
): boolean {
  if (!companyHasGeoDefault(company, locations)) {
    return true;
  }

  const businessTargets = buildSavedCustomLocations(company, locations);
  if (businessTargets.length === 0) {
    return true;
  }

  return businessTargets.every((unit) =>
    selectedLocations.some((selected) => isSameGeoTarget(unit, selected)),
  );
}

/** Same rule as the customer app: an explicit pick wins over the saved address. */
export function resolveEffectiveAiLocations(
  manualLocations: SelectedGeoLocation[],
  savedLocations: SelectedGeoLocation[],
): SelectedGeoLocation[] {
  return manualLocations.length > 0 ? manualLocations : savedLocations;
}

/** Location is asked only when there is no mold and no saved/picked address. */
export function needsAiLocationStep(
  hasMold: boolean,
  effectiveLocations: SelectedGeoLocation[],
): boolean {
  return !hasMold && effectiveLocations.length === 0;
}

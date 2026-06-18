import { describe, expect, test } from "bun:test";

import {
  buildGeoLocationsPayload,
  normalizeSelectedGeoLocation,
} from "../meta-business/geo-targeting-types";
import {
  mapGoogleAutocompleteResponse,
  mapGooglePlaceDetailsToGeoLocationSearchResult,
} from "./google-places-location-search";

describe("Google Places location search", () => {
  test("maps autocomplete predictions to pending custom locations", () => {
    const results = mapGoogleAutocompleteResponse({
      suggestions: [
        {
          placePrediction: {
            placeId: "places-123",
            text: { text: "Rua Gumercindo de Freitas, Campos dos Goytacazes" },
            structuredFormat: {
              mainText: { text: "Rua Gumercindo de Freitas" },
            },
          },
        },
        {
          placePrediction: {
            placeId: "places-123",
            text: { text: "Duplicated place" },
          },
        },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.key).toBe("google:places-123");
    expect(results[0]?.type).toBe("custom_location");
    expect(results[0]?.source).toBe("google_places");
    expect(results[0]?.place_id).toBe("places-123");
    expect(results[0]?.requires_details).toBe(true);
  });

  test("maps place details to a Meta custom location", () => {
    const result = mapGooglePlaceDetailsToGeoLocationSearchResult({
      id: "places-123",
      formattedAddress:
        "Rua Gumercindo de Freitas, 123 - Centro, Campos dos Goytacazes - RJ, 28030-295, Brasil",
      displayName: { text: "Rua Gumercindo de Freitas" },
      types: ["street_address"],
      location: {
        latitude: -21.757728,
        longitude: -41.32349,
      },
      addressComponents: [
        { longText: "123", types: ["street_number"] },
        { longText: "Rua Gumercindo de Freitas", types: ["route"] },
        { longText: "Centro", types: ["neighborhood"] },
        { longText: "Campos dos Goytacazes", types: ["locality"] },
        {
          longText: "Rio de Janeiro",
          shortText: "RJ",
          types: ["administrative_area_level_1"],
        },
        { longText: "28030-295", types: ["postal_code"] },
        { longText: "Brasil", shortText: "BR", types: ["country"] },
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.address_string).toBe(
      "123 Rua Gumercindo de Freitas, Centro, Campos dos Goytacazes, RJ, Brasil",
    );
    expect(result?.address_string?.includes("28030-295")).toBe(false);
    expect(result?.radius).toBe(1);
    expect(result?.distance_unit).toBe("kilometer");

    const payload = buildGeoLocationsPayload([
      normalizeSelectedGeoLocation(result!),
    ]);
    expect(payload?.custom_locations).toEqual([
      {
        address_string:
          "123 Rua Gumercindo de Freitas, Centro, Campos dos Goytacazes, RJ, Brasil",
        name: "Rua Gumercindo de Freitas",
        latitude: -21.757728,
        longitude: -41.32349,
        radius: 1,
        distance_unit: "kilometer",
      },
    ]);
  });

  test("uses postal code radius and excludes postal code from address string", () => {
    const result = mapGooglePlaceDetailsToGeoLocationSearchResult({
      id: "postal-123",
      displayName: { text: "28030-295" },
      types: ["postal_code"],
      location: { latitude: -21.75, longitude: -41.32 },
      addressComponents: [
        { longText: "Centro", types: ["neighborhood"] },
        { longText: "Campos dos Goytacazes", types: ["locality"] },
        { longText: "RJ", shortText: "RJ", types: ["administrative_area_level_1"] },
        { longText: "28030-295", types: ["postal_code"] },
        { longText: "Brasil", shortText: "BR", types: ["country"] },
      ],
    });

    expect(result?.radius).toBe(3);
    expect(result?.address_string).toBe(
      "Centro, Campos dos Goytacazes, RJ, Brasil",
    );
  });

  test("discards details without coordinates", () => {
    const result = mapGooglePlaceDetailsToGeoLocationSearchResult({
      id: "places-123",
      displayName: { text: "Rua Gumercindo de Freitas" },
      types: ["street_address"],
      addressComponents: [
        { longText: "Rua Gumercindo de Freitas", types: ["route"] },
      ],
    });

    expect(result).toBeNull();
  });

  test("buildGeoLocationsPayload never emits Meta city-like keys", () => {
    const payload = buildGeoLocationsPayload([
      {
        key: "2684440",
        name: "Campos dos Goytacazes",
        type: "city",
        radius: 5,
        distance_unit: "kilometer",
      },
      {
        key: "2786077",
        name: "Parque Turf Club",
        type: "neighborhood",
        radius: 10,
        distance_unit: "kilometer",
      },
    ]);

    expect(payload?.cities).toBeUndefined();
    expect(payload?.custom_locations).toBeUndefined();
  });

  test("buildGeoLocationsPayload preserves small radius for map-dragged custom locations", () => {
    const payload = buildGeoLocationsPayload([
      {
        key: "custom_-21.757728_-41.323490",
        name: "Centro, Campos dos Goytacazes",
        type: "custom_location",
        address_string: "Centro, Campos dos Goytacazes",
        latitude: -21.757728,
        longitude: -41.32349,
        radius: 3,
        distance_unit: "kilometer",
      },
    ]);

    expect(payload?.cities).toBeUndefined();
    expect(payload?.custom_locations).toEqual([
      {
        address_string: "Centro, Campos dos Goytacazes",
        name: "Centro, Campos dos Goytacazes",
        latitude: -21.757728,
        longitude: -41.32349,
        radius: 3,
        distance_unit: "kilometer",
      },
    ]);
  });
});

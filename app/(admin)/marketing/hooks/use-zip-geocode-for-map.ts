"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { buildLocationGeocodeQuery, buildZipGeocodeQuery } from "@/lib/geo/zip-geocode-query";
import {
  hasLocationCoordinates,
  type SelectedGeoLocation,
} from "@/lib/meta-business/geo-targeting-types";

export type ZipGeocodeEntry =
  | { kind: "ok"; latitude: number; longitude: number; sig: string }
  | { kind: "fail"; sig: string };

/** @deprecated use ZipGeocodeEntry; kept for merge/hasMap param naming */
export type GeocodeCoords = { latitude: number; longitude: number };

const GEOCODABLE_TYPES = new Set([
  "zip",
  "city",
  "subcity",
  "neighborhood",
  "place",
]);

function needsGeocode(location: SelectedGeoLocation): boolean {
  if (hasLocationCoordinates(location)) return false;
  return GEOCODABLE_TYPES.has(location.type);
}

function geocodeInputSig(location: SelectedGeoLocation): string {
  return [
    location.type,
    location.name?.trim() ?? "",
    location.primary_city?.trim() ?? "",
    location.region?.trim() ?? "",
    location.country_code?.trim() ?? "",
  ].join("|");
}

/**
 * Fetches approximate coordinates for locations without lat/lon
 * (OpenStreetMap via /api/geo/geocode) so the map can show a pin.
 * Meta targeting still uses the original keys (zip keys, city keys, etc.).
 */
export function useZipGeocodeForMap(selectedLocations: SelectedGeoLocation[]) {
  const [geocodeByKey, setGeocodeByKey] = useState<Record<string, ZipGeocodeEntry>>(
    {},
  );
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const geocodeByKeyRef = useRef(geocodeByKey);
  geocodeByKeyRef.current = geocodeByKey;

  const validKeySet = useMemo(
    () => new Set(selectedLocations.map((l) => l.key)),
    [selectedLocations],
  );

  useEffect(() => {
    setGeocodeByKey((prev) => {
      const next: Record<string, ZipGeocodeEntry> = { ...prev };
      for (const key of Object.keys(next)) {
        if (!validKeySet.has(key)) {
          delete next[key];
        }
      }
      return next;
    });
  }, [validKeySet]);

  useEffect(() => {
    const targets = selectedLocations.filter((location) => {
      if (!needsGeocode(location)) return false;
      const sig = geocodeInputSig(location);
      const entry = geocodeByKeyRef.current[location.key];
      if (entry?.kind === "ok" && entry.sig === sig) return false;
      if (entry?.kind === "fail" && entry.sig === sig) return false;
      return true;
    });

    if (targets.length === 0) return;

    setGeocodeByKey((prev) => {
      const next = { ...prev };
      for (const t of targets) {
        delete next[t.key];
      }
      return next;
    });

    let cancelled = false;
    setIsGeocoding(true);
    setGeocodeError(null);

    void (async () => {
      let lastFailureMessage: string | null = null;
      let anySuccess = false;

      try {
        for (const location of targets) {
          if (cancelled) return;

          const sig = geocodeInputSig(location);
          const q = location.type === "zip"
            ? buildZipGeocodeQuery(location)
            : buildLocationGeocodeQuery(location);

          const params = new URLSearchParams();
          if (q.trim()) {
            params.set("q", q);
          }
          if (location.type === "zip") {
            const postalDisplay = (location.name || location.key).trim();
            if (postalDisplay) {
              params.set("postalcode", postalDisplay);
            }
          }
          params.set("key", location.key);
          const countryCode = location.country_code?.trim().toLowerCase();
          if (countryCode) {
            params.set("countryCode", countryCode);
          }
          if (location.primary_city?.trim()) {
            params.set("city", location.primary_city.trim());
          }
          if (location.region?.trim()) {
            params.set("region", location.region.trim());
          }
          if (location.country_name?.trim()) {
            params.set("countryName", location.country_name.trim());
          }

          try {
            const response = await fetch(`/api/geo/geocode?${params.toString()}`);

            if (!response.ok) {
              const errBody = (await response.json()) as { message?: string };
              lastFailureMessage =
                errBody.message ?? `Geocode failed (${response.status})`;
              if (!cancelled) {
                setGeocodeByKey((prev) => ({
                  ...prev,
                  [location.key]: { kind: "fail", sig },
                }));
              }
              continue;
            }

            const data = (await response.json()) as {
              latitude: number;
              longitude: number;
            };

            if (cancelled) return;

            anySuccess = true;
            lastFailureMessage = null;

            setGeocodeByKey((prev) => ({
              ...prev,
              [location.key]: {
                kind: "ok",
                latitude: data.latitude,
                longitude: data.longitude,
                sig,
              },
            }));
          } catch (err) {
            lastFailureMessage =
              err instanceof Error ? err.message : "Geocoding failed";
            if (!cancelled) {
              setGeocodeByKey((prev) => ({
                ...prev,
                [location.key]: { kind: "fail", sig },
              }));
            }
          }
        }

        if (!cancelled) {
          setGeocodeError(anySuccess ? null : lastFailureMessage);
        }
      } catch (error) {
        if (!cancelled) {
          setGeocodeError(
            error instanceof Error ? error.message : "Geocoding failed",
          );
        }
      } finally {
        if (!cancelled) {
          setIsGeocoding(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedLocations]);

  return { geocodeByKey, isGeocoding, geocodeError };
}

export function mergeZipGeocodeForMap(
  location: SelectedGeoLocation,
  geocodeByKey: Record<string, ZipGeocodeEntry>,
): (SelectedGeoLocation & { latitude: number; longitude: number }) | null {
  if (hasLocationCoordinates(location)) {
    return {
      ...location,
      latitude: location.latitude,
      longitude: location.longitude,
    };
  }

  if (!GEOCODABLE_TYPES.has(location.type)) {
    return null;
  }

  const entry = geocodeByKey[location.key];
  if (!entry || entry.kind !== "ok") {
    return null;
  }

  return {
    ...location,
    latitude: entry.latitude,
    longitude: entry.longitude,
  };
}

export function hasMapCoordinates(
  location: SelectedGeoLocation,
  geocodeByKey: Record<string, ZipGeocodeEntry>,
): boolean {
  if (hasLocationCoordinates(location)) {
    return true;
  }

  const entry = geocodeByKey[location.key];
  return GEOCODABLE_TYPES.has(location.type) && entry?.kind === "ok";
}

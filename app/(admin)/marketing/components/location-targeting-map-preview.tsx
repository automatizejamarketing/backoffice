"use client";

import "leaflet/dist/leaflet.css";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { GripVertical, MapPin } from "lucide-react";
import L from "leaflet";
import { useLocationTargetingT } from "../utils/location-targeting-messages";
import { Circle, MapContainer, Marker, TileLayer, useMap } from "react-leaflet";

import type { SelectedGeoLocation } from "@/lib/meta-business/geo-targeting-types";

type LocationTargetingMapPreviewProps = {
  location: SelectedGeoLocation & { latitude: number; longitude: number };
  radiusKm: number;
  /** When the pin comes from OpenStreetMap geocoding (ZIP), not Meta coordinates */
  pinSource?: "meta" | "openstreetmap";
  /** Called when the user drags the pin to a new position */
  onLocationDrag?: (latitude: number, longitude: number) => void;
};

const markerIcon = L.divIcon({
  className: "location-targeting-map-pin",
  html: `
    <div style="position: relative; width: 24px; height: 24px;">
      <div style="position:absolute; inset:0; border-radius:9999px; background:rgba(76,73,190,0.18); transform:scale(1.55);"></div>
      <div style="position:absolute; inset:0; border-radius:9999px; background:#4C49BE; box-shadow:0 10px 30px rgba(76,73,190,0.35); border:3px solid rgba(255,255,255,0.94);"></div>
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

/** Fixes blank/wrong-sized maps when the container mounts hidden or animates open. */
function MapResizeInvalidate() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const invalidate = () => {
      map.invalidateSize({ animate: false });
    };

    invalidate();
    const raf = requestAnimationFrame(invalidate);
    const t1 = setTimeout(invalidate, 100);
    const t2 = setTimeout(invalidate, 400);

    const ro = new ResizeObserver(invalidate);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
    };
  }, [map]);

  return null;
}

function MapViewportSync({
  latitude,
  longitude,
  radiusKm,
}: {
  latitude: number;
  longitude: number;
  radiusKm: number;
}) {
  const map = useMap();
  const prevCenter = useRef<[number, number] | null>(null);

  useEffect(() => {
    const zoom = radiusKm <= 3 ? 15 : radiusKm <= 8 ? 14 : radiusKm <= 20 ? 13 : 12;
    map.invalidateSize({ animate: false });

    const prev = prevCenter.current;
    const isSmallMove =
      prev !== null &&
      Math.abs(prev[0] - latitude) < 0.05 &&
      Math.abs(prev[1] - longitude) < 0.05;

    if (isSmallMove) {
      map.setView([latitude, longitude], zoom, { animate: true });
    } else {
      map.flyTo([latitude, longitude], zoom, { animate: true, duration: 0.6 });
    }

    prevCenter.current = [latitude, longitude];
  }, [map, latitude, longitude, radiusKm]);

  return null;
}

export function LocationTargetingMapPreview({
  location,
  radiusKm,
  pinSource = "meta",
  onLocationDrag,
}: LocationTargetingMapPreviewProps) {
  const t = useLocationTargetingT();
  const center = useMemo<[number, number]>(
    () => [location.latitude, location.longitude],
    [location.latitude, location.longitude],
  );

  const markerRef = useRef<L.Marker>(null);
  const isDraggable = typeof onLocationDrag === "function";

  const handleDragEnd = useCallback(() => {
    const marker = markerRef.current;
    if (!marker || !onLocationDrag) return;

    const latlng = marker.getLatLng();
    onLocationDrag(latlng.lat, latlng.lng);
  }, [onLocationDrag]);

  return (
    <div className="isolate overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm shadow-black/5">
      <div className="border-b border-border/60 bg-linear-to-r from-primary/8 via-primary/4 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <MapPin className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{location.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {location.address_string ?? location.region ?? location.country_name}
            </p>
          </div>
        </div>
      </div>

      <div className="relative h-[320px] w-full overflow-hidden bg-muted/20">
        <MapContainer
          center={center}
          zoom={13}
          scrollWheelZoom={false}
          className="h-full w-full"
          attributionControl={false}
        >
          <MapResizeInvalidate />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <MapViewportSync
            latitude={location.latitude}
            longitude={location.longitude}
            radiusKm={radiusKm}
          />
          <Circle
            center={center}
            radius={radiusKm * 1000}
            pathOptions={{
              color: "#4C49BE",
              fillColor: "#7A7ADB",
              fillOpacity: 0.18,
              weight: 2,
            }}
          />
          <Marker
            ref={markerRef}
            position={center}
            icon={markerIcon}
            draggable={isDraggable}
            eventHandlers={isDraggable ? { dragend: handleDragEnd } : undefined}
          />
        </MapContainer>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-background via-background/75 to-transparent px-4 pb-3 pt-8">
          <div className="rounded-xl border border-border/60 bg-background/92 px-3 py-2 shadow-lg backdrop-blur">
            <p className="text-xs font-medium text-foreground">{t("mapPreviewTitle")}</p>
            <p className="text-[11px] text-muted-foreground">
              {t("mapPreviewHint")}
            </p>
            {isDraggable ? (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-primary/80">
                <GripVertical className="size-3" />
                {t("mapDragPinHint")}
              </p>
            ) : null}
            {pinSource === "openstreetmap" ? (
              <p className="mt-1 text-[11px] text-muted-foreground/90">
                {t("mapZipPinDisclaimer")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

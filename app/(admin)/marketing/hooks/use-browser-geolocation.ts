"use client";

import { useEffect, useRef, useState } from "react";

export type BrowserGeolocation = {
  latitude: number;
  longitude: number;
};

/**
 * Lazily captures the browser's geolocation once, the first time `enabled`
 * becomes true (e.g. when the location search popover opens). The result is
 * used only as a SOFT bias for Google Places autocomplete.
 *
 * Denial, unavailability, or timeout are intentionally silent: callers should
 * fall back to Vercel IP geolocation (handled server-side) and then to a
 * country-wide (Brazil) search. Never blocks the UI.
 */
export function useBrowserGeolocation(
  enabled: boolean,
): BrowserGeolocation | null {
  const [position, setPosition] = useState<BrowserGeolocation | null>(null);
  // A ref (not state) tracks whether we've already prompted: it must persist
  // across renders without triggering one, and avoids a setState-in-effect.
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!enabled || requestedRef.current) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return;
    }

    // Only ask once per mount; flipping `enabled` again won't re-prompt.
    requestedRef.current = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      () => {
        // Denied / unavailable / timed out — stay null and let the server
        // fall back to IP geolocation, then a Brazil-wide search.
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 },
    );
  }, [enabled]);

  return position;
}

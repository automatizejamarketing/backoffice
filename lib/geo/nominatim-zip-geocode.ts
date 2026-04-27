/**
 * Server-only: resolve approximate coordinates for ZIP / postal codes via Nominatim.
 * Uses several query strategies because Meta's labels often do not match a single free-text search.
 */

const USER_AGENT =
  "AutomatizeMarketing/1.0 (location map preview; contact via product support)";

type NominatimHit = {
  lat: string;
  lon: string;
  display_name?: string;
};

function sanitizeRegionForGeocode(region: string): string {
  return region
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Brazilian CEP: 8 digits, with or without hyphen */
function brazilCepVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) {
    return [];
  }
  const hyphenated = `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return Array.from(new Set([hyphenated, digits]));
}

function buildPostalCandidates(
  postalcode: string | undefined,
  key: string | undefined,
  countryCode: string | undefined,
): string[] {
  const raw = [postalcode, key]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());

  const out = new Set<string>();
  for (const s of raw) {
    out.add(s);
    if (countryCode === "br") {
      for (const v of brazilCepVariants(s)) {
        out.add(v);
      }
    }
  }
  return Array.from(out);
}

async function nominatimFetch(
  searchParams: URLSearchParams,
): Promise<NominatimHit | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  for (const [k, v] of searchParams.entries()) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as NominatimHit[];
  return data[0] ?? null;
}

export type ZipGeocodeInput = {
  /** Full free-text line (Meta-style context) */
  q: string;
  /** Display postal code, usually `location.name` */
  postalcode?: string;
  /** Meta targeting key; often same as postal code */
  key?: string;
  countryCode?: string;
  city?: string;
  region?: string;
  countryName?: string;
};

/**
 * Brazilian CEPs are 8 digits (e.g. 28026350). Meta often returns only the
 * 5-digit prefix (e.g. "28026") as the zip key. Nominatim cannot reliably
 * resolve partial CEPs to the right city, so we detect this case and
 * prioritize city-based geocoding instead.
 */
function isBrazilPartialCep(
  postalCandidates: string[],
  countryCode: string | undefined,
): boolean {
  if (countryCode !== "br") return false;
  return postalCandidates.every((p) => {
    const digits = p.replace(/\D/g, "");
    return digits.length > 0 && digits.length < 8;
  });
}

export async function geocodeZipWithNominatimFallbacks(
  input: ZipGeocodeInput,
): Promise<{ latitude: number; longitude: number; displayName?: string } | null> {
  const countryCode = input.countryCode?.trim().toLowerCase();
  const city = input.city?.trim();
  const region = input.region ? sanitizeRegionForGeocode(input.region) : undefined;
  const countryName = input.countryName?.trim();

  const postalCandidates = buildPostalCandidates(
    input.postalcode,
    input.key,
    countryCode,
  );

  const attempts: URLSearchParams[] = [];

  const partialBrCep = isBrazilPartialCep(postalCandidates, countryCode);

  // When we have a partial Brazilian CEP (< 8 digits) and Meta gave us a city,
  // prioritize city+region geocoding because Nominatim resolves partial CEPs
  // to the wrong municipality.
  if (partialBrCep && city) {
    if (countryCode) {
      const p = new URLSearchParams();
      p.set("q", region ? `${city}, ${region}` : city);
      p.set("countrycodes", countryCode);
      attempts.push(p);
    }
    if (countryName) {
      const p = new URLSearchParams();
      p.set("q", `${city}, ${countryName}`);
      attempts.push(p);
    }
  }

  // Full postal code lookups (only reliable for complete CEPs / non-BR zips)
  for (const postal of postalCandidates) {
    if (postal && countryCode) {
      const p = new URLSearchParams();
      p.set("postalcode", postal);
      p.set("countrycodes", countryCode);
      attempts.push(p);
    }
  }

  for (const postal of postalCandidates) {
    if (postal && countryCode === "br") {
      const p = new URLSearchParams();
      p.set("q", `${postal}, Brasil`);
      p.set("countrycodes", "br");
      attempts.push(p);
    }
  }

  for (const postal of postalCandidates) {
    if (postal && countryName) {
      const p = new URLSearchParams();
      p.set("q", `${postal}, ${countryName}`);
      if (countryCode) {
        p.set("countrycodes", countryCode);
      }
      attempts.push(p);
    }
  }

  if (input.q.trim()) {
    const q = input.q.trim();
    if (countryCode) {
      const p = new URLSearchParams();
      p.set("q", q);
      p.set("countrycodes", countryCode);
      attempts.push(p);
    }
    attempts.push(new URLSearchParams({ q }));
  }

  for (const postal of postalCandidates) {
    if (postal) {
      const p = new URLSearchParams();
      p.set("q", countryName ? `${postal}, ${countryName}` : postal);
      attempts.push(p);
    }
  }

  // City fallback for non-partial-BR cases (partial BR already added above)
  if (!partialBrCep && city && countryCode) {
    const p = new URLSearchParams();
    p.set("q", region ? `${city}, ${region}` : city);
    p.set("countrycodes", countryCode);
    attempts.push(p);
  }

  if (!partialBrCep && city && countryName) {
    const p = new URLSearchParams();
    p.set("q", `${city}, ${countryName}`);
    attempts.push(p);
  }

  const seen = new Set<string>();
  for (const params of attempts) {
    const key = params.toString();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const hit = await nominatimFetch(params);
    if (hit) {
      const latitude = Number.parseFloat(hit.lat);
      const longitude = Number.parseFloat(hit.lon);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return {
          latitude,
          longitude,
          displayName: hit.display_name,
        };
      }
    }
  }

  return null;
}

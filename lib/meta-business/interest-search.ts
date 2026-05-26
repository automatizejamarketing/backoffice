import type { MetaInterestSearchResult } from "./interest-targeting-types";
import { normalizeMetaLocale } from "./geo-location-search";

export type MetaInterestSearchResponse = {
  data?: Array<Record<string, unknown>>;
};

type BuildInterestSearchParamsArgs = {
  query: string;
  locale?: string;
  limit?: number;
};

type BuildInterestSuggestionParamsArgs = {
  names: string[];
  locale?: string;
  limit?: number;
};

type BuildInterestValidationParamsArgs = {
  ids: string[];
  locale?: string;
};

type BuildInterestBrowseParamsArgs = {
  locale?: string;
};

type BuildTargetingOptionStatusParamsArgs = {
  ids: string[];
};

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getPath(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const path = value.filter((p): p is string => typeof p === "string");
  return path.length > 0 ? path : undefined;
}

function toInterestResult(
  row: Record<string, unknown>,
): MetaInterestSearchResult | null {
  const id =
    getString(row.id) ??
    (typeof row.id === "number" ? String(row.id) : undefined);
  const name = getString(row.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    type: getString(row.type),
    audience_size: getNumber(row.audience_size),
    audience_size_lower_bound: getNumber(row.audience_size_lower_bound),
    audience_size_upper_bound: getNumber(row.audience_size_upper_bound),
    path: getPath(row.path),
    description: getString(row.description),
    valid: getBoolean(row.valid),
  };
}

export function mapMetaInterestSearchResults(
  response: MetaInterestSearchResponse,
): MetaInterestSearchResult[] {
  if (!Array.isArray(response.data)) return [];

  const seen = new Set<string>();
  const results: MetaInterestSearchResult[] = [];

  for (const row of response.data) {
    if (!row || typeof row !== "object") continue;
    const mapped = toInterestResult(row);
    if (!mapped || seen.has(mapped.id)) continue;
    seen.add(mapped.id);
    results.push(mapped);
  }

  return results;
}

export function buildInterestSearchParams({
  query,
  locale,
  limit = 25,
}: BuildInterestSearchParamsArgs): string {
  const params = new URLSearchParams({
    type: "adinterest",
    q: query,
    limit: String(limit),
    locale: normalizeMetaLocale(locale),
  });
  return params.toString();
}

export function buildInterestSuggestionParams({
  names,
  locale,
  limit = 25,
}: BuildInterestSuggestionParamsArgs): string {
  const params = new URLSearchParams({
    type: "adinterestsuggestion",
    interest_list: JSON.stringify(names),
    limit: String(limit),
    locale: normalizeMetaLocale(locale),
  });
  return params.toString();
}

export function buildInterestValidationParams({
  ids,
  locale,
}: BuildInterestValidationParamsArgs): string {
  const params = new URLSearchParams({
    type: "adinterestvalid",
    interest_fbid_list: JSON.stringify(ids),
    locale: normalizeMetaLocale(locale),
  });
  return params.toString();
}

export function buildInterestBrowseParams({
  locale,
}: BuildInterestBrowseParamsArgs = {}): string {
  const params = new URLSearchParams({
    type: "adTargetingCategory",
    class: "interests",
    locale: normalizeMetaLocale(locale),
  });
  return params.toString();
}

export function buildTargetingOptionStatusParams({
  ids,
}: BuildTargetingOptionStatusParamsArgs): string {
  const params = new URLSearchParams({
    type: "targetingoptionstatus",
    targeting_option_list: JSON.stringify(ids),
  });
  return params.toString();
}

export function getInvalidInterestIdsFromValidation(
  results: MetaInterestSearchResult[],
  submittedIds: string[],
): string[] {
  const validIds = new Set(
    results.filter((r) => r.valid !== false).map((r) => r.id),
  );
  return submittedIds.filter((id) => !validIds.has(id));
}

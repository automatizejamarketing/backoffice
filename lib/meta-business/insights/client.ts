/**
 * Low-level client helpers shared by the 5 marketing tools.
 *
 * Thin layer over the existing {@link metaApiCall} (Graph API v25.0). Centralizes:
 * per-request context, a single rate-limit retry with backoff (design §7,
 * principle: tools handle RATE_LIMIT internally before surfacing), and query-param
 * builders (date range, sort, status filtering) so the model never touches API
 * syntax (design §1 principle 5).
 */
import { metaApiCall, type MetaApiCallParams } from "@/lib/meta-business/api";
import { isSameAccount, withActPrefix } from "@/lib/meta-business/account-match";
import { mapErrorKind } from "./envelope";

/**
 * Per-request context injected into every tool (principle 2: one ad account per
 * session, token + account injected per request, never global).
 */
export type MetaCtx = {
  /** Numeric ad account id (with or without the `act_` prefix). */
  adAccountId: string;
  /** Live user access token resolved per request. */
  accessToken: string;
  /** Account currency code (e.g. "BRL") from getAccountContext. */
  currency: string;
  /** Account timezone (e.g. "America/Sao_Paulo") — date presets resolve here. */
  timezoneName: string;
};

/**
 * Ensure the `act_` prefix exactly as the existing routes do. One implementation
 * for the whole layer — see `lib/meta-business/account-match.ts` for which Graph
 * paths need which form.
 */
export function formatAccountId(adAccountId: string): string {
  return withActPrefix(adAccountId);
}

/**
 * Resolve a caller-supplied "parent object" id for an ACCOUNT-EDGE read.
 *
 * A tool caller (the model, in practice) may hand the AD ACCOUNT itself where a
 * campaign/ad-set id is expected — "rank the campaigns under X", where X is the
 * account. Meta only exposes the account's edges on `act_{id}`, so passing the
 * bare account id straight into `{id}/insights` produces
 * "(#100) Tried accessing nonexisting field (insights)" (Vercel report A-06).
 *
 * Returns `null` when the parent IS the conversation account — meaning "there is
 * no parent object; this is the account-wide read", which the callers already
 * build correctly via {@link formatAccountId}. Any other id is returned untouched:
 * a campaign/ad-set/ad node is addressed BARE, so prefixing it would break every
 * object-scoped read (and a bare id from ANOTHER account must keep reaching the
 * cross-account ownership guard rather than being silently rewritten).
 */
export function resolveParentObjectId(
  parentId: string | undefined,
  adAccountId: string,
): string | null {
  if (!parentId) return null;
  return isSameAccount(parentId, adAccountId) ? null : parentId;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Call the Graph API with ONE automatic retry on a rate-limit error, backing off
 * the server-suggested amount when present (design §7). Other errors propagate to
 * the tool, which wraps them in an envelope via {@link mapErrorKind}.
 */
export async function callMeta<T>(
  args: MetaApiCallParams,
  options: { retryOnRateLimit?: boolean } = {},
): Promise<T> {
  const { retryOnRateLimit = true } = options;
  try {
    return await metaApiCall<T>(args);
  } catch (error) {
    if (!retryOnRateLimit) throw error;
    const mapped = mapErrorKind(error);
    if (mapped.kind !== "RATE_LIMIT") throw error;
    // Quando a Meta informa quanto falta para o acesso voltar
    // (estimated_time_to_regain_access costuma ser MINUTOS), re-tentar em ≤5s é
    // uma chamada garantidamente desperdiçada — e chamadas desperdiçadas são o
    // que rebaixa o tier do app. Só vale o retry no throttle curto/anônimo.
    if ((mapped.retryAfterMs ?? 0) > 5000) throw error;
    const wait = Math.min(Math.max(mapped.retryAfterMs ?? 1500, 500), 5000);
    await sleep(wait);
    return await metaApiCall<T>(args); // single retry
  }
}

// ---- query param builders --------------------------------------------------

export type DateParams = {
  datePreset?: string;
  since?: string;
  until?: string;
};

/**
 * Build the date portion of an insights query as encoded `key=value` parts.
 * `time_range` (custom) takes precedence over `date_preset`. Returns [] when
 * neither is provided (caller decides the default).
 */
export function buildDateParts({ datePreset, since, until }: DateParams): string[] {
  if (since && until) {
    const range = JSON.stringify({ since, until });
    return [`time_range=${encodeURIComponent(range)}`];
  }
  if (datePreset) return [`date_preset=${encodeURIComponent(datePreset)}`];
  return [];
}

/** Build a `sort=<field>_<direction>` part for the insights edge. */
export function buildSortPart(field: string, direction: "asc" | "desc"): string {
  const suffix = direction === "asc" ? "ascending" : "descending";
  return `sort=${field}_${suffix}`;
}

export type StatusScope = "ACTIVE_PAUSED" | "ACTIVE" | "PAUSED" | "WITH_ARCHIVED" | "ALL";

// A child inside a paused parent reports CAMPAIGN_PAUSED / ADSET_PAUSED instead of
// PAUSED (BUG-005). Include those wherever PAUSED appears, so NO listing — default
// OR an explicit WITH_ARCHIVED/ALL the agent picks — silently drops the children of
// a paused campaign/ad set. Mirrors CHILD_EFFECTIVE_STATUSES in the marketing UI's
// queries (app/(main)/marketing/hooks/marketing-queries.ts). Campaigns never carry
// these cascade states, so listing them at any level is harmless.
const CASCADE_PAUSED = ["CAMPAIGN_PAUSED", "ADSET_PAUSED"];

const STATUS_VALUES: Record<StatusScope, string[]> = {
  // Default: active + paused (incl. cascade-paused); excludes archived/deleted.
  ACTIVE_PAUSED: ["ACTIVE", "PAUSED", ...CASCADE_PAUSED],
  ACTIVE: ["ACTIVE"],
  PAUSED: ["PAUSED", ...CASCADE_PAUSED],
  WITH_ARCHIVED: ["ACTIVE", "PAUSED", ...CASCADE_PAUSED, "ARCHIVED"],
  ALL: ["ACTIVE", "PAUSED", ...CASCADE_PAUSED, "ARCHIVED", "DELETED"],
};

type Filter = { field: string; operator: string; value: string | string[] };

/** Build an encoded `filtering=[...]` part from a list of Graph filters. */
export function buildFilteringPart(filters: Filter[]): string {
  return `filtering=${encodeURIComponent(JSON.stringify(filters))}`;
}

/**
 * Compose filters for a findObjects query: partial name match (CONTAIN) + an
 * effective-status scope. `nameField` differs by level only in edge cases; Graph
 * accepts `name` on campaigns/adsets/ads.
 */
export function buildObjectFilters(params: {
  nameContains?: string;
  status: StatusScope;
  parentField?: string;
  parentId?: string;
}): Filter[] {
  const filters: Filter[] = [];
  if (params.nameContains) {
    filters.push({
      field: "name",
      operator: "CONTAIN",
      value: params.nameContains,
    });
  }
  filters.push({
    field: "effective_status",
    operator: "IN",
    value: STATUS_VALUES[params.status],
  });
  if (params.parentField && params.parentId) {
    filters.push({
      field: params.parentField,
      operator: "EQUAL",
      value: params.parentId,
    });
  }
  return filters;
}

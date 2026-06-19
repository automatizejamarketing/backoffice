import { metaApiCall } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";

/**
 * Native Meta `/copies` duplication, orchestrated entity-by-entity.
 *
 * We deliberately DO NOT use `deep_copy=true` on campaign or ad set copies.
 * Meta enforces a hard sync-copy limit (errorSubcode 1885194: "the number of
 * ad objects to copy at once must be fewer than 3") that any campaign with
 * more than 2 ad sets, or any ad set with more than 2 ads, would hit. The
 * official async batch fallback returns the same error per the public Meta
 * developer-community thread, so the only universally-reliable path is to
 * copy one entity per call.
 *
 * Source objects are NEVER modified. Two non-mutating self-repairs keep copies
 * succeeding when Meta re-validates legacy config against today's rules:
 * - Ad set: when native `/copies` is permanently refused (e.g. Explore Home
 *   without Explore), the ad set is reconstructed via `POST /adsets` with
 *   sanitized targeting, gated by `validate_only` (see `rebuildAdsetInto`).
 * - Ad: a copy refused for a deprecated creative bundle (3858504) or a missing
 *   sales URL (2446383) is retried with `creative_parameters` (see
 *   `copyAdWithRepair`).
 *
 * Partial success: ads Meta will never accept for an ad-specific reason
 * (`SKIPPABLE_AD_SUBCODES`, e.g. copyrighted-music reels) are SKIPPED and
 * reported, not fatal. An ad set left with zero ads is dropped; if the whole
 * campaign copies zero ads, it fails and rolls back. Any other failure (a hard
 * error, or a rename failure) still deletes every object created during the
 * attempt, in reverse order.
 *
 * Otherwise Meta preserves the configuration (targeting, budget, creative,
 * promoted_object, schedule, ...). We rename the copied tree after the fact to
 * follow the creation convention (`<base>`, `<base> - Ad Set`, `<base> - Ad`).
 *
 * Constraints enforced here:
 * - Ad set copy is always created in the destination campaign.
 * - Ad copy is always created in the destination ad set.
 * - Status of native copies is inherited from the source (INHERITED_FROM_SOURCE);
 *   a reconstructed ad set is created PAUSED (its ads are copied in right after).
 */

const COPY_MARKER = "Cópia";
const STATUS_OPTION = "INHERITED_FROM_SOURCE";
const NO_RENAME = JSON.stringify({ rename_strategy: "NO_RENAME" });
const VALIDATE_ONLY = JSON.stringify(["validate_only"]);

/**
 * Floor for a lifetime ad set's flight window. Meta rejects lifetime ad sets
 * whose `end_time` is not more than 24h after `start_time` (subcode 1487094);
 * we use 25h to stay clear of clock skew.
 */
const MIN_FLIGHT_MS = 25 * 60 * 60 * 1000;
/** Fallback flight length when the source window can't be derived. */
const DEFAULT_FLIGHT_MS = 30 * 24 * 60 * 60 * 1000;
/** Small buffer so the rebuilt `start_time` is unambiguously in the future. */
const START_BUFFER_MS = 5 * 60 * 1000;

/**
 * Meta subcode 2446383: "Call to action required". Sales objectives now
 * demand an external website URL on the creative; legacy ads created without
 * one fail re-validation on copy. When the caller supplies a fallback
 * promotion URL we retry the copy with `creative_parameters` (supported by
 * the Ad Copies API since May 2025) injecting the missing link.
 */
const CALL_TO_ACTION_URL_REQUIRED = 2446383;

/**
 * Meta subcode 2061015: "website URL required" — the same missing-sales-link
 * problem as 2446383, but raised for other creative shapes (e.g. Instagram-post
 * boosts). Repaired the same way: reuse the source's existing link, else ask.
 */
const WEBSITE_URL_REQUIRED = 2061015;

/** Both "needs a website/sales URL" rejections, repaired by injecting a link. */
const URL_REQUIRED_SUBCODES = new Set<number>([
  CALL_TO_ACTION_URL_REQUIRED,
  WEBSITE_URL_REQUIRED,
]);

/**
 * Meta subcode 3858504: the deprecated Advantage+ "standard enhancements"
 * bundle. Copies of legacy creatives that still carry it are refused; we strip
 * it (keeping the individual features) via `creative_parameters`.
 */
const STANDARD_ENHANCEMENTS_DEPRECATED = 3858504;

/** Ad-copy rejections we can fix non-destructively via `creative_parameters`. */
const REPAIRABLE_AD_SUBCODES = new Set<number>([
  CALL_TO_ACTION_URL_REQUIRED,
  WEBSITE_URL_REQUIRED,
  STANDARD_ENHANCEMENTS_DEPRECATED,
]);

/**
 * Ad-copy rejections Meta will NEVER accept for that specific ad, whatever we
 * send. The rest of the tree can still be duplicated, so these ads are skipped
 * and reported instead of failing the whole operation. Keep this list narrow:
 * only provably-unfixable, ad-specific errors belong here.
 */
const SKIPPABLE_AD_SUBCODES = new Set<number>([
  2875030, // reels using copyrighted music can't be boosted as ads
]);

/**
 * Actionable guidance appended to Meta errors we can't fix automatically.
 * Keyed by Meta `error_subcode`.
 */
const ERROR_HINTS_BY_SUBCODE: Record<number, string> = {
  2446383:
    'Edite o link do anúncio original (botão "Editar link") para definir a URL do site e tente duplicar novamente.',
  2061015:
    'Edite o link do anúncio original (botão "Editar link") para definir a URL do site e tente duplicar novamente.',
  1870227:
    "Atualize o conjunto de anúncios original no Gerenciador de Anúncios para atender às regras atuais da Meta e tente duplicar novamente.",
  2490392:
    "Atualize os posicionamentos do conjunto de anúncios original no Gerenciador de Anúncios (Instagram Explore) e tente duplicar novamente.",
};

// Cap parallel ad copies inside a single ad set so we don't trigger Meta's
// rate limiter on large adsets (25+ ads). Chosen empirically: high enough to
// hide round-trip latency, low enough to stay under Meta's per-app throttle.
const AD_COPY_CONCURRENCY = 5;

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

/**
 * `<name> - Cópia`, or `<name> - Cópia 2`, `... 3` when a sibling already uses
 * the previous variant. Meta allows duplicate names; this just avoids confusion.
 */
function resolveCopyName(baseName: string, existingNames: string[]): string {
  const taken = new Set(existingNames);
  const first = `${baseName} - ${COPY_MARKER}`;
  if (!taken.has(first)) return first;
  let n = 2;
  while (taken.has(`${baseName} - ${COPY_MARKER} ${n}`)) n += 1;
  return `${baseName} - ${COPY_MARKER} ${n}`;
}

/**
 * Mirrors the creation naming: a single child has no numeric suffix; multiple
 * children get ` 2`, ` 3`, ... (see `create-*-campaign.ts` and the backoffice
 * adsets POST route — `${base} - Ad${suffix}`).
 */
function childSuffix(count: number, index: number): string {
  return count > 1 ? ` ${index + 1}` : "";
}

function missingCopyIdError(kind: string): GraphApiError {
  return new GraphApiError({
    statusCode: 502,
    reason: {
      httpStatusCode: 502,
      title: "Falha na duplicação",
      message: `A Meta não retornou o ID ${kind} da cópia.`,
      solution: "Tente novamente em alguns instantes.",
      isTransient: true,
    },
  });
}

/**
 * Prefer Meta's own `error_user_title` / `error_user_msg` (the exact phrasing
 * Ads Manager shows) over our generic mapped message — code 100 ("Invalid
 * parameter") alone is useless for diagnosing why a copy was refused. The
 * subcode is appended so support can look the case up in Meta's error
 * reference.
 */
function errorMessage(err: unknown): string {
  if (err instanceof GraphApiError) {
    const { data, reason } = err.errorReturn;
    const detail =
      data?.errorUserMsg ??
      data?.message ??
      reason.message ??
      reason.title ??
      "Erro desconhecido";
    let message =
      data?.errorUserTitle && data?.errorUserMsg
        ? `${data.errorUserTitle}: ${detail}`
        : detail;
    if (data?.errorSubcode) {
      message = `${message} (código ${data.errorSubcode})`;
      const hint = ERROR_HINTS_BY_SUBCODE[data.errorSubcode];
      if (hint) message = `${message} ${hint}`;
    }
    return message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function graphErrorSubcode(err: unknown): number | undefined {
  return err instanceof GraphApiError
    ? err.errorReturn.data?.errorSubcode
    : undefined;
}

type CopyResponse = {
  copied_campaign_id?: string;
  copied_adset_id?: string;
  copied_ad_id?: string;
};

type NamedNode = { id: string; name?: string };

type CampaignTree = {
  name?: string;
  /** Present (CBO) when the budget lives on the campaign rather than the ad sets. */
  daily_budget?: string;
  lifetime_budget?: string;
  adsets?: {
    data?: Array<{
      id: string;
      name?: string;
      ads?: { data?: NamedNode[] };
    }>;
  };
};

/**
 * The subset of ad-set fields a faithful rebuild needs to reproduce. Read back
 * from the source ad set when native `/copies` is refused (see `rebuildAdsetInto`).
 */
type AdsetFull = {
  name?: string;
  status?: string;
  configured_status?: string;
  billing_event?: string;
  optimization_goal?: string;
  optimization_sub_event?: string;
  destination_type?: string;
  promoted_object?: Record<string, unknown>;
  attribution_spec?: unknown;
  bid_strategy?: string;
  bid_amount?: number | string;
  bid_constraints?: unknown;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
  adset_schedule?: unknown[];
  is_dynamic_creative?: boolean;
  targeting?: Record<string, unknown>;
};

const ADSET_REBUILD_FIELDS = [
  "name",
  "configured_status",
  "billing_event",
  "optimization_goal",
  "optimization_sub_event",
  "destination_type",
  "promoted_object",
  "attribution_spec",
  "bid_strategy",
  "bid_amount",
  "bid_constraints",
  "daily_budget",
  "lifetime_budget",
  "start_time",
  "end_time",
  "adset_schedule",
  "is_dynamic_creative",
  "targeting",
].join(",");

function hasPositiveMinorUnits(value: unknown): boolean {
  if (value == null) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/**
 * Only a permanent (non-transient) Meta rejection should trigger a rebuild. A
 * transient failure (rate limit, 503) means native `/copies` would likely
 * succeed on retry, so rebuilding would needlessly trade a faithful native copy
 * for a reconstructed one. `isTransient` comes from our code/subcode map in
 * `error.ts` — validation errors (code 100, incl. subcode 2490392) are `false`.
 */
function isPermanentGraphFailure(err: unknown): boolean {
  return err instanceof GraphApiError && err.errorReturn.reason.isTransient === false;
}

export type FailedCopy = {
  /** Source object id (the one we tried to copy). */
  sourceId: string;
  sourceName?: string;
  /** Source ad set id, only set for failed ad copies. */
  sourceAdsetId?: string;
  /** Why Meta rejected (or the call timed out). */
  error: string;
};

/** An ad (or ad set) that was skipped during a partial duplication. */
export type SkippedItem = {
  /** Source object id that could not be copied. */
  sourceId: string;
  sourceName?: string;
  /** Meta's own reason (error_user_msg + subcode) for surfacing to the admin. */
  reason: string;
};

export type DuplicateResult = {
  id: string;
  name: string;
  sourceName: string;
  /** Ads Meta refused to copy for an un-fixable, ad-specific reason. */
  skippedAds?: SkippedItem[];
  /** Ad sets dropped because every one of their ads was skipped. */
  skippedAdsets?: SkippedItem[];
};

/**
 * Thrown when atomic duplication fails. When rollback succeeds, no new objects
 * remain on Meta. When rollback partially fails, `orphanIds` lists objects
 * that could not be deleted and require manual cleanup.
 */
export class DuplicateAtomicError extends GraphApiError {
  readonly rolledBack: boolean;
  readonly orphanIds?: string[];
  /**
   * True when the underlying Meta rejection was the "call to action / website
   * URL required" error (subcode 2446383). The client uses this to ask the
   * user for a promotion URL and retry the duplication with it.
   */
  readonly needsPromotionUrl?: boolean;

  constructor(args: {
    message: string;
    solution: string;
    statusCode?: number;
    rolledBack: boolean;
    orphanIds?: string[];
    isTransient?: boolean;
    needsPromotionUrl?: boolean;
  }) {
    super({
      statusCode: args.statusCode ?? 502,
      reason: {
        httpStatusCode: args.statusCode ?? 502,
        title: "Falha na duplicação",
        message: args.message,
        solution: args.solution,
        isTransient: args.isTransient ?? false,
      },
    });
    this.rolledBack = args.rolledBack;
    this.orphanIds = args.orphanIds;
    this.needsPromotionUrl = args.needsPromotionUrl;
  }
}

type CreatedObjectKind = "campaign" | "adset" | "ad";

type CreatedObject = {
  kind: CreatedObjectKind;
  id: string;
};

class CreatedObjectsTracker {
  private readonly objects: CreatedObject[] = [];

  track(kind: CreatedObjectKind, id: string): void {
    this.objects.push({ kind, id });
  }

  /**
   * Forget an object after it has been intentionally deleted during a SUCCESSFUL
   * partial run (a dropped empty ad set), so a later rollback won't try to delete
   * it again.
   */
  untrack(id: string): void {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx >= 0) this.objects.splice(idx, 1);
  }

  async rollback(accessToken: string): Promise<string[]> {
    const failedIds: string[] = [];
    for (const obj of [...this.objects].reverse()) {
      const deleted = await deleteMetaObject(obj.id, accessToken);
      if (!deleted) failedIds.push(obj.id);
    }
    return failedIds;
  }
}

async function deleteMetaObject(
  objectId: string,
  accessToken: string,
): Promise<boolean> {
  try {
    await metaApiCall<{ success?: boolean }>({
      domain: "FACEBOOK",
      method: "DELETE",
      path: objectId,
      params: "",
      accessToken,
    });
    return true;
  } catch {
    return false;
  }
}

async function rollbackAndThrow(
  tracker: CreatedObjectsTracker,
  accessToken: string,
  cause: unknown,
): Promise<never> {
  const orphanIds = await tracker.rollback(accessToken);
  const originalMessage = errorMessage(cause);

  if (orphanIds.length > 0) {
    throw new DuplicateAtomicError({
      message: `${originalMessage} A duplicação foi revertida parcialmente; remova manualmente os objetos órfãos: ${orphanIds.join(", ")}.`,
      solution:
        "Remova os objetos listados no Gerenciador de Anúncios e tente duplicar novamente.",
      rolledBack: false,
      orphanIds,
    });
  }

  throw new DuplicateAtomicError({
    message: `A duplicação falhou e foi revertida. ${originalMessage}`,
    solution: "Corrija o problema indicado e tente duplicar novamente.",
    rolledBack: true,
    // Only on a clean rollback do we offer the reactive promotion-URL retry:
    // when objects were orphaned the user must clean those up first, so we
    // surface the hard error (with orphan IDs) instead.
    needsPromotionUrl: URL_REQUIRED_SUBCODES.has(graphErrorSubcode(cause) ?? -1),
  });
}

/** Extra fields for API error responses after atomic rollback. */
export function duplicateErrorExtras(error: unknown): {
  rolledBack?: boolean;
  orphanIds?: string[];
  needsPromotionUrl?: boolean;
} {
  if (!(error instanceof DuplicateAtomicError)) return {};
  return {
    rolledBack: error.rolledBack,
    ...(error.orphanIds?.length ? { orphanIds: error.orphanIds } : {}),
    ...(error.needsPromotionUrl ? { needsPromotionUrl: true } : {}),
  };
}

/**
 * Run `fn` over `items` with at most `concurrency` workers in flight.
 * Preserves input order in the output array.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function renameObject(
  objectId: string,
  name: string,
  accessToken: string,
): Promise<void> {
  await metaApiCall<{ success?: boolean; id?: string }>({
    domain: "FACEBOOK",
    method: "POST",
    path: objectId,
    params: "",
    body: new URLSearchParams({ name }),
    accessToken,
  });
}

async function getCampaignTree(
  campaignId: string,
  accessToken: string,
): Promise<CampaignTree> {
  return metaApiCall<CampaignTree>({
    domain: "FACEBOOK",
    method: "GET",
    path: campaignId,
    params:
      "fields=name,daily_budget,lifetime_budget,adsets.limit(200){id,name,ads.limit(200){id,name}}",
    accessToken,
  });
}

async function listAdsetAds(
  adsetId: string,
  accessToken: string,
): Promise<NamedNode[]> {
  const res = await metaApiCall<{ data?: NamedNode[] }>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${adsetId}/ads`,
    params: "fields=id,name&limit=200",
    accessToken,
  });
  return res.data ?? [];
}

/**
 * Copy a single ad set into a target campaign. No `deep_copy`: this only
 * creates the ad set itself; ads are copied separately by the caller.
 */
async function copyAdsetInto(
  sourceAdsetId: string,
  targetCampaignId: string,
  accessToken: string,
): Promise<string | undefined> {
  const res = await metaApiCall<CopyResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${sourceAdsetId}/copies`,
    params: "",
    body: new URLSearchParams({
      campaign_id: targetCampaignId,
      status_option: STATUS_OPTION,
      rename_options: NO_RENAME,
    }),
    accessToken,
  });
  return res.copied_adset_id;
}

/**
 * Sanitize a Graph-read `targeting` object for re-creation. Meta returns more on
 * GET than it accepts on POST; we make the minimum changes proven necessary:
 *
 * 1. Drop `age_range` — a read-only derived field.
 * 2. Add `explore` whenever `explore_home` is present without it. Meta now
 *    enforces (subcode 2490392) that the Instagram *Explore Home* placement
 *    requires the *Explore* placement too; ad sets created before that rule copy
 *    fine in Ads Manager but are refused on re-validation. Both are valid
 *    `instagram_positions` values.
 *
 * Everything else (audience names, geo `region_id`/`primary_city_id`,
 * `flexible_spec`, `advantage_audience`) is preserved verbatim — Meta accepts
 * its own read-back. The `validate_only` gate in `rebuildAdsetInto` catches any
 * residual read-only field, so this list can grow as cases surface.
 */
function sanitizeTargetingForRebuild(
  targeting: Record<string, unknown>,
): Record<string, unknown> {
  const t = JSON.parse(JSON.stringify(targeting ?? {})) as Record<string, unknown>;
  delete t.age_range;
  const positions = t.instagram_positions;
  if (
    Array.isArray(positions) &&
    positions.includes("explore_home") &&
    !positions.includes("explore")
  ) {
    t.instagram_positions = [...positions, "explore"];
  }
  return t;
}

/**
 * Choose the rebuilt ad set's flight window. A lifetime ad set (own lifetime
 * budget, or any ad set under a CBO lifetime campaign) MUST have a future
 * `end_time` (subcode 1487094). When the source window is still in the future we
 * keep it verbatim; when it has already passed we preserve the original duration
 * anchored to now (floored to Meta's >24h minimum). Daily-budget ad sets need no
 * end date — we mirror the wizard's ongoing `end_time=0`.
 */
function computeRebuildSchedule(
  source: AdsetFull,
  effectiveLifetime: boolean,
): { start_time?: string; end_time?: string } {
  if (!effectiveLifetime) return { end_time: "0" };

  const now = Date.now();
  const srcStart = source.start_time ? Date.parse(source.start_time) : NaN;
  const srcEnd = source.end_time ? Date.parse(source.end_time) : NaN;

  if (!Number.isNaN(srcEnd) && srcEnd > now + MIN_FLIGHT_MS) {
    return { start_time: source.start_time, end_time: source.end_time };
  }

  const duration =
    !Number.isNaN(srcStart) && !Number.isNaN(srcEnd) && srcEnd > srcStart
      ? srcEnd - srcStart
      : DEFAULT_FLIGHT_MS;
  const start = now + START_BUFFER_MS;
  const end = start + Math.max(duration, MIN_FLIGHT_MS);
  return {
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
  };
}

/**
 * Build the `POST act_/adsets` body that faithfully reconstructs `source` inside
 * `targetCampaignId`, with sanitized targeting and a valid flight window. Budget
 * and bid are carried ONLY for ABO — under CBO they live on the (already copied)
 * campaign and Meta rejects ad-set budgets (error 4834002).
 */
function buildRebuildAdsetBody(args: {
  source: AdsetFull;
  targetCampaignId: string;
  isCBO: boolean;
  effectiveLifetime: boolean;
}): URLSearchParams {
  const { source, targetCampaignId, isCBO, effectiveLifetime } = args;

  const body = new URLSearchParams({
    name: source.name ?? "Conjunto",
    campaign_id: targetCampaignId,
    billing_event: source.billing_event ?? "IMPRESSIONS",
    optimization_goal: source.optimization_goal ?? "OFFSITE_CONVERSIONS",
    targeting: JSON.stringify(sanitizeTargetingForRebuild(source.targeting ?? {})),
    // Created paused: the duplicated tree is for review before relaunch, and an
    // ad set can't activate before its ads exist (they are copied in next).
    status: "PAUSED",
  });

  if (source.optimization_sub_event && source.optimization_sub_event !== "NONE") {
    body.set("optimization_sub_event", source.optimization_sub_event);
  }
  if (source.destination_type && source.destination_type !== "UNDEFINED") {
    body.set("destination_type", source.destination_type);
  }
  if (source.promoted_object) {
    const po: Record<string, unknown> = { ...source.promoted_object };
    delete po.smart_pse_enabled; // read-only
    body.set("promoted_object", JSON.stringify(po));
  }
  if (source.attribution_spec) {
    body.set("attribution_spec", JSON.stringify(source.attribution_spec));
  }

  if (!isCBO) {
    if (source.bid_strategy) body.set("bid_strategy", source.bid_strategy);
    if (source.bid_amount != null) body.set("bid_amount", String(source.bid_amount));
    if (source.bid_constraints) {
      body.set("bid_constraints", JSON.stringify(source.bid_constraints));
    }
    if (hasPositiveMinorUnits(source.lifetime_budget)) {
      body.set("lifetime_budget", String(source.lifetime_budget));
    } else if (hasPositiveMinorUnits(source.daily_budget)) {
      body.set("daily_budget", String(source.daily_budget));
    }
  }

  const schedule = computeRebuildSchedule(source, effectiveLifetime);
  if (schedule.start_time) body.set("start_time", schedule.start_time);
  if (schedule.end_time) body.set("end_time", schedule.end_time);

  if (Array.isArray(source.adset_schedule) && source.adset_schedule.length > 0) {
    body.set("pacing_type", JSON.stringify(["day_parting"]));
    body.set("adset_schedule", JSON.stringify(source.adset_schedule));
  }

  if (source.is_dynamic_creative) body.set("is_dynamic_creative", "true");

  return body;
}

/**
 * Fallback when native ad-set `/copies` is permanently refused (e.g. the source
 * targeting is now invalid by current rules, like Explore Home without Explore).
 * The `/copies` endpoint can't override targeting and the source can't be edited
 * (it may belong to an ended campaign), so we reconstruct the ad set instead:
 * read the source, sanitize, and create it in the target campaign.
 *
 * Gated by `validate_only`: if Meta won't accept the reconstructed ad set we
 * throw the ORIGINAL copy rejection so the caller rolls back exactly as before —
 * the rebuild can only ever turn a failure into a success, never mask one.
 * The SOURCE ad set is never modified. Ads are copied in by the caller.
 */
async function rebuildAdsetInto(args: {
  accountId: string;
  sourceAdsetId: string;
  targetCampaignId: string;
  accessToken: string;
  isCBO: boolean;
  campaignLifetime: boolean;
  originalError: unknown;
}): Promise<string> {
  const {
    accountId,
    sourceAdsetId,
    targetCampaignId,
    accessToken,
    isCBO,
    campaignLifetime,
    originalError,
  } = args;
  const act = formatAccountId(accountId);

  const source = await metaApiCall<AdsetFull>({
    domain: "FACEBOOK",
    method: "GET",
    path: sourceAdsetId,
    params: `fields=${ADSET_REBUILD_FIELDS}`,
    accessToken,
  });

  const effectiveLifetime = isCBO
    ? campaignLifetime
    : hasPositiveMinorUnits(source.lifetime_budget);

  const body = buildRebuildAdsetBody({
    source,
    targetCampaignId,
    isCBO,
    effectiveLifetime,
  });

  const validateBody = new URLSearchParams(body);
  validateBody.set("execution_options", VALIDATE_ONLY);
  try {
    await metaApiCall<{ success?: boolean }>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${act}/adsets`,
      params: "",
      body: validateBody,
      accessToken,
    });
  } catch {
    // Couldn't repair into a valid ad set — surface the real copy rejection.
    throw originalError;
  }

  const created = await metaApiCall<{ id?: string }>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${act}/adsets`,
    params: "",
    body,
    accessToken,
  });
  if (!created.id) throw missingCopyIdError("do conjunto");
  return created.id;
}

/**
 * Copy an ad set natively, falling back to a `validate_only`-gated rebuild when
 * native `/copies` is permanently refused. Returns the new ad set id.
 */
async function copyOrRebuildAdsetInto(args: {
  accountId: string;
  sourceAdsetId: string;
  targetCampaignId: string;
  accessToken: string;
  isCBO: boolean;
  campaignLifetime: boolean;
}): Promise<string> {
  const {
    accountId,
    sourceAdsetId,
    targetCampaignId,
    accessToken,
    isCBO,
    campaignLifetime,
  } = args;

  let copiedAdsetId: string | undefined;
  try {
    copiedAdsetId = await copyAdsetInto(
      sourceAdsetId,
      targetCampaignId,
      accessToken,
    );
  } catch (copyErr) {
    if (!isPermanentGraphFailure(copyErr)) throw copyErr;
    return rebuildAdsetInto({
      accountId,
      sourceAdsetId,
      targetCampaignId,
      accessToken,
      isCBO,
      campaignLifetime,
      originalError: copyErr,
    });
  }
  if (!copiedAdsetId) throw missingCopyIdError("do conjunto");
  return copiedAdsetId;
}

/**
 * Copy a single ad into a target ad set. Meta duplicates the creative as part
 * of this call. `creativeParameters` (optional, JSON string) overrides
 * top-level creative fields on the copy — see the Ad Copies reference.
 */
async function copyAdInto(
  sourceAdId: string,
  targetAdsetId: string,
  accessToken: string,
  creativeParameters?: string,
): Promise<string | undefined> {
  const body = new URLSearchParams({
    adset_id: targetAdsetId,
    status_option: STATUS_OPTION,
    rename_options: NO_RENAME,
  });
  if (creativeParameters) {
    body.set("creative_parameters", creativeParameters);
  }

  const res = await metaApiCall<CopyResponse>({
    domain: "FACEBOOK",
    method: "POST",
    path: `${sourceAdId}/copies`,
    params: "",
    body,
    accessToken,
  });
  return res.copied_ad_id;
}

type GraphCtaValue = { link?: string; [key: string]: unknown };
type GraphCta = { type?: string; value?: GraphCtaValue; [key: string]: unknown };

type GraphCreativeShape = {
  id?: string;
  call_to_action?: GraphCta;
  source_instagram_media_id?: string;
  degrees_of_freedom_spec?: {
    creative_features_spec?: Record<string, unknown>;
    [key: string]: unknown;
  };
  object_story_spec?: {
    link_data?: { link?: string; call_to_action?: GraphCta; [key: string]: unknown };
    video_data?: { call_to_action?: GraphCta; [key: string]: unknown };
    [key: string]: unknown;
  };
  asset_feed_spec?: {
    link_urls?: Array<{ website_url?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
};

function withCtaLink(cta: GraphCta | undefined, link: string): GraphCta {
  return {
    ...(cta ?? {}),
    type: cta?.type ?? "ORDER_NOW",
    value: { ...(cta?.value ?? {}), link },
  };
}

/**
 * Fetch the source ad's creative with the fields the repair patches need
 * (two GETs: ad → creative id → creative). Returns null when it can't be read.
 */
async function getRepairableCreative(
  sourceAdId: string,
  accessToken: string,
): Promise<GraphCreativeShape | null> {
  try {
    const ad = await metaApiCall<{ creative?: { id?: string } }>({
      domain: "FACEBOOK",
      method: "GET",
      path: sourceAdId,
      params: "fields=creative{id}",
      accessToken,
    });
    const creativeId = ad.creative?.id;
    if (!creativeId) return null;
    return await metaApiCall<GraphCreativeShape>({
      domain: "FACEBOOK",
      method: "GET",
      path: creativeId,
      params:
        "fields=call_to_action,source_instagram_media_id,degrees_of_freedom_spec,object_story_spec,asset_feed_spec",
      accessToken,
    });
  } catch {
    return null;
  }
}

/** First website URL found anywhere in the creative, or null. */
function extractCreativeUrl(creative: GraphCreativeShape): string | null {
  return (
    creative.object_story_spec?.link_data?.link ??
    creative.object_story_spec?.link_data?.call_to_action?.value?.link ??
    creative.object_story_spec?.video_data?.call_to_action?.value?.link ??
    creative.call_to_action?.value?.link ??
    creative.asset_feed_spec?.link_urls?.find((l) => l.website_url)?.website_url ??
    null
  );
}

/**
 * Patch that injects `promotionUrl` into the creative, shaped per creative type
 * (mirrors the promotion-link edit flow). Top-level overwrite, so nested specs
 * are cloned wholesale with only the link fields changed.
 */
function buildPromotionUrlPatch(
  creative: GraphCreativeShape,
  promotionUrl: string,
): Record<string, unknown> {
  if (creative.asset_feed_spec?.link_urls?.length) {
    const assetFeedSpec = JSON.parse(
      JSON.stringify(creative.asset_feed_spec),
    ) as NonNullable<GraphCreativeShape["asset_feed_spec"]>;
    assetFeedSpec.link_urls = assetFeedSpec.link_urls?.map((link) => ({
      ...link,
      website_url: promotionUrl,
    }));
    return { asset_feed_spec: assetFeedSpec };
  }
  if (creative.object_story_spec?.link_data) {
    const objectStorySpec = JSON.parse(
      JSON.stringify(creative.object_story_spec),
    ) as NonNullable<GraphCreativeShape["object_story_spec"]>;
    objectStorySpec.link_data = {
      ...objectStorySpec.link_data,
      link: promotionUrl,
      call_to_action: withCtaLink(
        objectStorySpec.link_data?.call_to_action,
        promotionUrl,
      ),
    };
    return { object_story_spec: objectStorySpec };
  }
  if (creative.object_story_spec?.video_data) {
    const objectStorySpec = JSON.parse(
      JSON.stringify(creative.object_story_spec),
    ) as NonNullable<GraphCreativeShape["object_story_spec"]>;
    objectStorySpec.video_data = {
      ...objectStorySpec.video_data,
      call_to_action: withCtaLink(
        objectStorySpec.video_data?.call_to_action,
        promotionUrl,
      ),
    };
    return { object_story_spec: objectStorySpec };
  }
  return { call_to_action: withCtaLink(creative.call_to_action, promotionUrl) };
}

/**
 * Patch that removes the deprecated `standard_enhancements` bundle from the
 * creative's Advantage+ feature spec, keeping the individual features. Returns
 * null when the bundle isn't present.
 */
function buildStripStandardEnhancementsPatch(
  creative: GraphCreativeShape,
): Record<string, unknown> | null {
  const dof = creative.degrees_of_freedom_spec;
  const feats = dof?.creative_features_spec;
  if (!feats || !("standard_enhancements" in feats)) return null;
  const stripped: Record<string, unknown> = { ...feats };
  delete stripped.standard_enhancements;
  return { degrees_of_freedom_spec: { ...dof, creative_features_spec: stripped } };
}

/**
 * The `creative_parameters` patch for a repairable ad-copy subcode, or null when
 * it can't be repaired — e.g. a sales URL is required but the source has none
 * and no fallback was supplied, which then bubbles up as `needsPromotionUrl`.
 */
function buildAdRepairPatch(
  subcode: number,
  creative: GraphCreativeShape,
  fallbackPromotionUrl?: string,
): Record<string, unknown> | null {
  if (subcode === STANDARD_ENHANCEMENTS_DEPRECATED) {
    return buildStripStandardEnhancementsPatch(creative);
  }
  if (URL_REQUIRED_SUBCODES.has(subcode)) {
    const url = extractCreativeUrl(creative) ?? fallbackPromotionUrl ?? null;
    return url ? buildPromotionUrlPatch(creative, url) : null;
  }
  return null;
}

/**
 * `copyAdInto` with non-mutating self-repair. On a repairable rejection
 * (deprecated standard enhancements 3858504; missing sales URL 2446383) we read
 * the source creative once and retry with an accumulating `creative_parameters`
 * patch — an ad can hit more than one in sequence. The SOURCE ad is never
 * modified. Unrepairable rejections (including skippable ones like
 * copyrighted-music reels) bubble up unchanged for the caller to classify.
 */
async function copyAdWithRepair(
  sourceAdId: string,
  targetAdsetId: string,
  accessToken: string,
  fallbackPromotionUrl?: string,
): Promise<string | undefined> {
  try {
    return await copyAdInto(sourceAdId, targetAdsetId, accessToken);
  } catch (firstErr) {
    const firstSub = graphErrorSubcode(firstErr);
    if (firstSub == null || !REPAIRABLE_AD_SUBCODES.has(firstSub)) throw firstErr;

    const creative = await getRepairableCreative(sourceAdId, accessToken);
    if (!creative) throw firstErr;

    const patch: Record<string, unknown> = {};
    const applied = new Set<number>();
    let lastErr: unknown = firstErr;

    for (let attempt = 0; attempt < REPAIRABLE_AD_SUBCODES.size + 1; attempt += 1) {
      const sub = graphErrorSubcode(lastErr);
      if (sub == null || !REPAIRABLE_AD_SUBCODES.has(sub) || applied.has(sub)) {
        throw lastErr;
      }
      const repairPatch = buildAdRepairPatch(sub, creative, fallbackPromotionUrl);
      if (!repairPatch) throw lastErr;
      Object.assign(patch, repairPatch);
      applied.add(sub);
      try {
        return await copyAdInto(
          sourceAdId,
          targetAdsetId,
          accessToken,
          JSON.stringify(patch),
        );
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }
}

type CopiedAd = { sourceAd: NamedNode; copiedAdId: string };

type AdCopyOutcome =
  | { kind: "ok"; sourceAd: NamedNode; copiedAdId: string }
  | { kind: "skip"; sourceAd: NamedNode; reason: string }
  | { kind: "fail"; sourceAd: NamedNode; error: unknown };

/**
 * Copy every ad in `sourceAds` into `targetAdsetId` with bounded concurrency,
 * tracking each success for rollback. Ads Meta will never accept for an
 * ad-specific reason (`SKIPPABLE_AD_SUBCODES`) are skipped and returned in
 * `skippedAds`. Any OTHER failure rethrows the ORIGINAL Meta error after all
 * workers finish — so every created id is known for rollback and the subcode is
 * preserved (e.g. 2446383 → `needsPromotionUrl`).
 */
async function copyAdsIntoAdset(
  sourceAds: NamedNode[],
  targetAdsetId: string,
  accessToken: string,
  tracker: CreatedObjectsTracker,
  fallbackPromotionUrl?: string,
): Promise<{ copiedAds: CopiedAd[]; skippedAds: SkippedItem[] }> {
  const outcomes = await mapWithConcurrency<NamedNode, AdCopyOutcome>(
    sourceAds,
    AD_COPY_CONCURRENCY,
    async (ad) => {
      try {
        const copiedAdId = await copyAdWithRepair(
          ad.id,
          targetAdsetId,
          accessToken,
          fallbackPromotionUrl,
        );
        if (!copiedAdId) {
          return { kind: "fail", sourceAd: ad, error: missingCopyIdError("do anúncio") };
        }
        tracker.track("ad", copiedAdId);
        return { kind: "ok", sourceAd: ad, copiedAdId };
      } catch (err) {
        const sub = graphErrorSubcode(err);
        if (sub != null && SKIPPABLE_AD_SUBCODES.has(sub)) {
          return { kind: "skip", sourceAd: ad, reason: errorMessage(err) };
        }
        return { kind: "fail", sourceAd: ad, error: err };
      }
    },
  );

  const failure = outcomes.find(
    (o): o is Extract<AdCopyOutcome, { kind: "fail" }> => o.kind === "fail",
  );
  if (failure) throw failure.error;

  const copiedAds: CopiedAd[] = [];
  const skippedAds: SkippedItem[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === "ok") {
      copiedAds.push({ sourceAd: outcome.sourceAd, copiedAdId: outcome.copiedAdId });
    } else if (outcome.kind === "skip") {
      skippedAds.push({
        sourceId: outcome.sourceAd.id,
        sourceName: outcome.sourceAd.name,
        reason: outcome.reason,
      });
    }
  }
  return { copiedAds, skippedAds };
}

/**
 * Duplicates a campaign (and its full tree: ad sets + ads) one entity at a
 * time, avoiding Meta's sync-copy size limit entirely. Renames the copied
 * tree to follow the creation convention. Rolls back all newly created objects
 * if any child copy or rename fails.
 */
export async function duplicateCampaign(args: {
  accountId: string;
  campaignId: string;
  accessToken: string;
  /** Website URL injected into ad copies whose creative lacks one (sales). */
  fallbackPromotionUrl?: string;
}): Promise<DuplicateResult> {
  const { accountId, campaignId, accessToken, fallbackPromotionUrl } = args;
  const act = formatAccountId(accountId);
  const tracker = new CreatedObjectsTracker();

  try {
    const sourceTree = await getCampaignTree(campaignId, accessToken);
    const sourceAdsets = sourceTree.adsets?.data ?? [];

    // Budget mode of the source campaign decides what a rebuild may set on an
    // ad set: under CBO the budget/bid live on the (already copied) campaign.
    const isCBO =
      hasPositiveMinorUnits(sourceTree.daily_budget) ||
      hasPositiveMinorUnits(sourceTree.lifetime_budget);
    const campaignLifetime = hasPositiveMinorUnits(sourceTree.lifetime_budget);

    const siblings = await metaApiCall<{ data?: NamedNode[] }>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${act}/campaigns`,
      params: "fields=name&limit=500",
      accessToken,
    });

    const newName = resolveCopyName(
      sourceTree.name ?? "Campanha",
      (siblings.data ?? []).map((c) => c.name ?? ""),
    );

    const campaignCopy = await metaApiCall<CopyResponse>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${campaignId}/copies`,
      params: "",
      body: new URLSearchParams({
        status_option: STATUS_OPTION,
        rename_options: NO_RENAME,
      }),
      accessToken,
    });

    const newCampaignId = campaignCopy.copied_campaign_id;
    if (!newCampaignId) throw missingCopyIdError("da campanha");
    tracker.track("campaign", newCampaignId);

    type AdsetCopyState = {
      sourceAdset: NamedNode;
      copiedAdsetId: string;
      copiedAds: Array<{ sourceAd: NamedNode; copiedAdId: string }>;
    };

    const adsetStates: AdsetCopyState[] = [];
    const skippedAds: SkippedItem[] = [];
    const skippedAdsets: SkippedItem[] = [];

    for (const sourceAdset of sourceAdsets) {
      const copiedAdsetId = await copyOrRebuildAdsetInto({
        accountId: act,
        sourceAdsetId: sourceAdset.id,
        targetCampaignId: newCampaignId,
        accessToken,
        isCBO,
        campaignLifetime,
      });
      tracker.track("adset", copiedAdsetId);

      const sourceAds =
        sourceAdset.ads?.data ??
        (await listAdsetAds(sourceAdset.id, accessToken));
      const { copiedAds, skippedAds: skipped } = await copyAdsIntoAdset(
        sourceAds,
        copiedAdsetId,
        accessToken,
        tracker,
        fallbackPromotionUrl,
      );
      skippedAds.push(...skipped);

      if (copiedAds.length === 0) {
        // Every ad in this set was un-copyable → drop the now-empty ad set.
        await deleteMetaObject(copiedAdsetId, accessToken);
        tracker.untrack(copiedAdsetId);
        skippedAdsets.push({
          sourceId: sourceAdset.id,
          sourceName: sourceAdset.name,
          reason: "Todos os anúncios do conjunto são inelegíveis para duplicação.",
        });
        continue;
      }
      adsetStates.push({ sourceAdset, copiedAdsetId, copiedAds });
    }

    if (adsetStates.length === 0) {
      // Nothing copyable anywhere — surface a clear reason and roll back.
      throw new GraphApiError({
        statusCode: 502,
        reason: {
          httpStatusCode: 502,
          title: "Falha na duplicação",
          message:
            "Nenhum anúncio pôde ser copiado: todos os anúncios desta campanha são inelegíveis para duplicação (por exemplo, reels com música protegida por direitos autorais).",
          solution:
            "Ajuste a mídia/música dos anúncios de origem no Gerenciador de Anúncios e tente duplicar novamente.",
          isTransient: false,
        },
      });
    }

    await renameObject(newCampaignId, newName, accessToken);

    const totalAds = adsetStates.reduce(
      (acc, state) => acc + state.copiedAds.length,
      0,
    );
    let adIndex = 0;
    for (let i = 0; i < adsetStates.length; i += 1) {
      const state = adsetStates[i];
      await renameObject(
        state.copiedAdsetId,
        `${newName} - Ad Set${childSuffix(adsetStates.length, i)}`,
        accessToken,
      );

      for (const copiedAd of state.copiedAds) {
        await renameObject(
          copiedAd.copiedAdId,
          `${newName} - Ad${childSuffix(totalAds, adIndex)}`,
          accessToken,
        );
        adIndex += 1;
      }
    }

    return {
      id: newCampaignId,
      name: newName,
      sourceName: sourceTree.name ?? "Campanha",
      ...(skippedAds.length ? { skippedAds } : {}),
      ...(skippedAdsets.length ? { skippedAdsets } : {}),
    };
  } catch (err) {
    return rollbackAndThrow(tracker, accessToken, err);
  }
}

/**
 * Duplicates an ad set (with its ads) WITHIN THE SAME campaign, copying the
 * ad set itself and each ad individually so Meta's sync-copy limit is never
 * hit. Rolls back the new ad set and ads if any child copy or rename fails.
 */
export async function duplicateAdSet(args: {
  accountId: string;
  adsetId: string;
  accessToken: string;
  /** Website URL injected into ad copies whose creative lacks one (sales). */
  fallbackPromotionUrl?: string;
}): Promise<DuplicateResult> {
  const { accountId, adsetId, accessToken, fallbackPromotionUrl } = args;
  const tracker = new CreatedObjectsTracker();

  try {
    const source = await metaApiCall<{ name?: string; campaign_id?: string }>({
      domain: "FACEBOOK",
      method: "GET",
      path: adsetId,
      params: "fields=name,campaign_id",
      accessToken,
    });

    if (!source.campaign_id) throw missingCopyIdError("da campanha de origem");

    const [siblings, sourceAds, campaign] = await Promise.all([
      metaApiCall<{ data?: NamedNode[] }>({
        domain: "FACEBOOK",
        method: "GET",
        path: `${source.campaign_id}/adsets`,
        params: "fields=name&limit=500",
        accessToken,
      }),
      listAdsetAds(adsetId, accessToken),
      metaApiCall<{ daily_budget?: string; lifetime_budget?: string }>({
        domain: "FACEBOOK",
        method: "GET",
        path: source.campaign_id,
        params: "fields=daily_budget,lifetime_budget",
        accessToken,
      }),
    ]);

    const isCBO =
      hasPositiveMinorUnits(campaign.daily_budget) ||
      hasPositiveMinorUnits(campaign.lifetime_budget);
    const campaignLifetime = hasPositiveMinorUnits(campaign.lifetime_budget);

    const newName = resolveCopyName(
      source.name ?? "Conjunto",
      (siblings.data ?? []).map((a) => a.name ?? ""),
    );

    const newAdsetId = await copyOrRebuildAdsetInto({
      accountId,
      sourceAdsetId: adsetId,
      targetCampaignId: source.campaign_id,
      accessToken,
      isCBO,
      campaignLifetime,
    });
    tracker.track("adset", newAdsetId);

    const { copiedAds, skippedAds } = await copyAdsIntoAdset(
      sourceAds,
      newAdsetId,
      accessToken,
      tracker,
      fallbackPromotionUrl,
    );

    if (copiedAds.length === 0) {
      // A duplicated ad set with no ads is pointless — fail and roll it back.
      throw new GraphApiError({
        statusCode: 502,
        reason: {
          httpStatusCode: 502,
          title: "Falha na duplicação",
          message:
            "Nenhum anúncio pôde ser copiado: todos os anúncios deste conjunto são inelegíveis para duplicação (por exemplo, reels com música protegida por direitos autorais).",
          solution:
            "Ajuste a mídia/música dos anúncios de origem no Gerenciador de Anúncios e tente duplicar novamente.",
          isTransient: false,
        },
      });
    }

    await renameObject(newAdsetId, newName, accessToken);

    for (let i = 0; i < copiedAds.length; i += 1) {
      await renameObject(
        copiedAds[i].copiedAdId,
        `${newName} - Ad${childSuffix(copiedAds.length, i)}`,
        accessToken,
      );
    }

    return {
      id: newAdsetId,
      name: newName,
      sourceName: source.name ?? "Conjunto",
      ...(skippedAds.length ? { skippedAds } : {}),
    };
  } catch (err) {
    return rollbackAndThrow(tracker, accessToken, err);
  }
}

/**
 * Copies an ad WITHIN THE SAME ad set. Single-entity `/copies` already fits
 * Meta's sync limit comfortably, so this path is unchanged from before.
 */
export async function duplicateAd(args: {
  accountId: string;
  adId: string;
  accessToken: string;
  /** Website URL injected into the copy when the creative lacks one (sales). */
  fallbackPromotionUrl?: string;
}): Promise<DuplicateResult> {
  const { adId, accessToken, fallbackPromotionUrl } = args;
  const tracker = new CreatedObjectsTracker();

  try {
    const source = await metaApiCall<{ name?: string; adset_id?: string }>({
      domain: "FACEBOOK",
      method: "GET",
      path: adId,
      params: "fields=name,adset_id",
      accessToken,
    });

    if (!source.adset_id) throw missingCopyIdError("do conjunto de origem");

    const siblings = await metaApiCall<{ data?: NamedNode[] }>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${source.adset_id}/ads`,
      params: "fields=name&limit=500",
      accessToken,
    });

    const newName = resolveCopyName(
      source.name ?? "Anúncio",
      (siblings.data ?? []).map((a) => a.name ?? ""),
    );

    const newAdId = await copyAdWithRepair(
      adId,
      source.adset_id,
      accessToken,
      fallbackPromotionUrl,
    );
    if (!newAdId) throw missingCopyIdError("do anúncio");
    tracker.track("ad", newAdId);

    await renameObject(newAdId, newName, accessToken);

    return {
      id: newAdId,
      name: newName,
      sourceName: source.name ?? "Anúncio",
    };
  } catch (err) {
    return rollbackAndThrow(tracker, accessToken, err);
  }
}

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
 * reported, not fatal. Copyrighted-music reels are detected BEFORE the copy by
 * reading the source media's `boost_eligibility_info` (`fetchBoostIneligibleMedia`)
 * and pre-skipped, so we don't spend a 2875030 error per reel against the app's Meta
 * error budget; a reel that slips past the pre-check is still caught reactively. An
 * ad set left with zero ads is dropped; if the whole campaign copies zero ads, it
 * fails and rolls back. Any other failure (a hard error, or a rename failure) still
 * deletes every object created during the attempt, in reverse order.
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

/**
 * Meta subcode 2490085: the creative uses an image crop key Meta deprecated for the
 * latest API version — e.g. `191x100`, removed in favor of flexible image aspect
 * ratios (1.91:1 → 1:1, no mandatory crop; Meta recommends `100x100`). On `/copies`,
 * v25 re-validates and rejects it. We strip the deprecated key(s) from the creative's
 * `image_crops` via `creative_parameters` (letting Meta apply its flexible aspect
 * ratio), exactly like the standard-enhancements strip. See
 * https://developers.facebook.com/docs/marketing-api/image-crops/ and the 2019
 * flexible-image-aspect-ratio announcement.
 */
const DEPRECATED_IMAGE_CROP = 2490085;
/** Image crop keys Meta has deprecated; extend as more are removed. */
const DEPRECATED_IMAGE_CROP_KEYS = new Set<string>(["191x100"]);

/** Ad-copy rejections we can fix non-destructively via `creative_parameters`. */
const REPAIRABLE_AD_SUBCODES = new Set<number>([
  CALL_TO_ACTION_URL_REQUIRED,
  WEBSITE_URL_REQUIRED,
  STANDARD_ENHANCEMENTS_DEPRECATED,
  DEPRECATED_IMAGE_CROP,
]);

/**
 * Ad-copy rejections Meta will NEVER accept for that specific ad, whatever we
 * send. The rest of the tree can still be duplicated, so these ads are skipped
 * and reported instead of failing the whole operation. Keep this list narrow:
 * only provably-unfixable, ad-specific errors belong here.
 */
const SKIPPABLE_AD_SUBCODES = new Set<number>([
  2875030, // reels using copyrighted music can't be boosted as ads
  // NOTE: 2875030 is also PRE-DETECTED (before any `/copies`) via the source media's
  // `boost_eligibility_info` (see `fetchBoostIneligibleMedia`), so it normally never
  // reaches here. This stays as the reactive safety net if the pre-check is unavailable.
  1815629, // duplicate asset values — safety net: the crop-strip dedup
  // (`dedupeImagesByContent`) normally collapses identical images before the copy, so
  // this rarely fires; if a creative still produces duplicate assets, skip that ad
  // instead of failing the whole tree (never worse than dropping just the ad).
  1885878, // dynamic-creative customization rule maps to multiple descriptions (one is
  // allowed) — a deep legacy asset_feed_spec quirk we don't rewrite; skip the ad and
  // report it rather than failing the whole tree.
]);

/**
 * Meta subcode 1487202: the token lacks permission to create ads for the ad's
 * Facebook Page. Meta subcode 2446149: a campaign-budget (CBO) campaign's budget is
 * too low to cover an additional ad set.
 *
 * Neither is something the ad-set REBUILD can change — it only sanitizes targeting,
 * and the reconstructed ad set references the SAME Page and lives under the SAME
 * campaign budget. So if native `/copies` fails this way, attempting the rebuild just
 * spends a SECOND doomed 4xx against the app's Meta error budget for the same outcome.
 * We rethrow the original error immediately instead (see `isRebuildUnfixable`). Keep
 * this narrow: only errors the rebuild provably cannot resolve belong here.
 */
const PAGE_ADS_PERMISSION_REQUIRED = 1487202;
const CBO_BUDGET_TOO_LOW = 2446149;
const REBUILD_UNFIXABLE_SUBCODES = new Set<number>([
  PAGE_ADS_PERMISSION_REQUIRED,
  CBO_BUDGET_TOO_LOW,
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
  2446149:
    "Esta campanha usa orçamento de campanha (CBO): aumente o orçamento da campanha para cobrir o conjunto adicional, ou reduza a quantidade de conjuntos, e tente duplicar novamente.",
};

// Cap parallel ad copies inside a single ad set so we don't trigger Meta's
// rate limiter on large adsets (25+ ads). Chosen empirically: high enough to
// hide round-trip latency, low enough to stay under Meta's per-app throttle.
const AD_COPY_CONCURRENCY = 5;

// ───────────────────────────────────────────────────────────────────────────
// Throttle-aware retry + write pacing
//
// Duplicating a large tree is many writes (Meta scores a write at 3 points). A
// transient throttle used to bubble up to `rollbackAndThrow` and delete the whole
// partially-built tree, so the user retried and re-spent every call — the rollback
// AMPLIFIED the rate limit. We now retry transient throttles in place (waiting the
// server-suggested time) and space write bursts, so a momentary limit no longer
// destroys the operation.
// ───────────────────────────────────────────────────────────────────────────

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 800;
/** Cap a single backoff so one retry can't blow the serverless function budget. */
const RETRY_MAX_WAIT_MS = 20_000;
/** Minimum spacing between write *starts* during the concurrent ad-copy phase. */
const MIN_WRITE_INTERVAL_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Marketing-API throttle / rate-limit error codes (from Meta's Rate Limiting
 * reference). These are the ONLY errors safe to retry: a throttle is rejected
 * BEFORE any object is created, so a retry can't double-create. We match on the
 * Graph error `code` — NOT the mapped HTTP status (`genericError` maps everything
 * to 500) and NOT `reason.isTransient` (whose `genericError` default of `true`
 * wrongly retried permanent param errors like #194 six times).
 */
const RETRYABLE_THROTTLE_CODES = new Set<number>([
  4, // application request limit reached
  17, // user request limit reached
  341, // application limit reached
  368, // temporarily blocked for policy violations
  613, // calls-per-ad-account / QPS exceeded (incl. subcode 5044001)
  80000, // BUC ads_management rate limit
  80003,
  80004,
  80014,
  1404078, // temporarily blocked
  2859015, // action temporarily blocked
]);

/**
 * True only for a genuine Meta throttle (see `RETRYABLE_THROTTLE_CODES`). Synthetic
 * local errors (no `data`) and every permanent rejection (param errors, 1870227,
 * #194, …) return false, so the caller's rebuild/skip/rollback logic runs unchanged.
 */
function isRetryableMetaError(err: unknown): boolean {
  if (!(err instanceof GraphApiError)) return false;
  const code = err.errorReturn.data?.code;
  return code != null && RETRYABLE_THROTTLE_CODES.has(code);
}

/** Backoff for attempt N, honoring Meta's suggested wait but capped to the budget. */
function retryWaitMs(err: unknown, attempt: number): number {
  const rl = err instanceof GraphApiError ? err.errorReturn.rateLimit : undefined;
  const serverWait = Math.max(rl?.retryAfterMs ?? 0, rl?.estimatedRegainMs ?? 0);
  const backoff = RETRY_BASE_MS * 2 ** attempt;
  const jitter = Math.floor(backoff * 0.25 * Math.random());
  return Math.min(RETRY_MAX_WAIT_MS, Math.max(serverWait, backoff + jitter));
}

/**
 * Run a single Meta WRITE with throttle-aware retry. On a retryable throttle we
 * wait the server-suggested time (or exponential backoff) and try again, up to
 * `MAX_RETRY_ATTEMPTS`; anything else rethrows immediately so existing
 * rebuild/skip/rollback behavior is unchanged. This is what stops a momentary
 * rate limit from rolling back the whole duplicated tree.
 */
async function withMetaRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableMetaError(err) || attempt >= MAX_RETRY_ATTEMPTS) throw err;
      await sleep(retryWaitMs(err, attempt));
      attempt += 1;
    }
  }
}

/**
 * Spaces the START of each scheduled call by at least `minIntervalMs` (a simple
 * QPS smoother) while letting the calls run concurrently. One limiter is shared
 * across a duplication so the bounded-parallel ad copies don't fire as a single
 * burst against Meta's per-account mutation rate limit.
 */
type WriteLimiter = <T>(fn: () => Promise<T>) => Promise<T>;
function createWriteLimiter(minIntervalMs: number): WriteLimiter {
  let gate: Promise<unknown> = Promise.resolve();
  let last = 0;
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const ready = gate.then(async () => {
      const wait = minIntervalMs - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    // The next caller waits only for this gate slot, not for fn() to finish, so
    // starts stay spaced while the fn()s themselves overlap up to the pool size.
    gate = ready.catch(() => undefined);
    return ready.then(fn);
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Legacy ASC/AAC guard (Meta v25 refuses to copy these)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Campaign `smart_promotion_type` values for the legacy Advantage+ Shopping (ASC)
 * and Advantage+ App (AAC) campaigns that Meta refuses to create/update/copy from
 * Graph API v25 — `POST /{campaign-id}/copies` is explicitly listed as affected in
 * the v25 changelog. Campaigns migrated to the new Advantage+ structure read
 * `GUIDED_CREATION` and are unaffected. Re-validate this set against the live
 * Campaign reference; the entity-by-entity path still rolls back if Meta adds
 * values we don't catch here.
 */
const ASC_AAC_SMART_PROMOTION_TYPES = new Set<string>([
  "AUTOMATED_SHOPPING_ADS",
  "SMART_APP_PROMOTION",
]);

/**
 * Refuse, up front, to duplicate a legacy ASC/AAC campaign so we surface a clear,
 * non-transient message before spending any call instead of failing mid-way and
 * rolling back. Call before the rollback scope so the message isn't wrapped as a
 * "reverted" failure.
 */
function assertCopyableCampaignType(smartPromotionType: string | undefined): void {
  if (
    smartPromotionType &&
    ASC_AAC_SMART_PROMOTION_TYPES.has(smartPromotionType)
  ) {
    throw new GraphApiError({
      statusCode: 422,
      reason: {
        httpStatusCode: 422,
        title: "Campanha não pode ser duplicada",
        message:
          "Campanhas Advantage+ Shopping/App (ASC/AAC) não podem mais ser duplicadas pela API a partir da versão 25 da Meta.",
        solution:
          "Abra o Gerenciador de Anúncios e use a opção 'Duplicar' diretamente na campanha.",
        isTransient: false,
      },
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Async deep-copy fast path
//
// Meta caps a *synchronous* deep_copy at 3 children but allows up to 51 via an
// async batch job it paces internally — far fewer calls from us. We use it only
// when the whole subtree fits, and ALWAYS fall back to the entity-by-entity path
// (which self-repairs and skips ineligible ads) on any failure, so the set of
// campaigns that copy successfully never shrinks. The async job CANNOT apply our
// per-item self-repairs, which is exactly why the fallback is the success floor.
//
// NOTE: validate the exact async wire format/result shape against a live v25 ad
// account. If Meta's shape differs from what we parse, this path simply falls
// back — duplication stays correct, just without the call savings until tuned.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Async deep_copy is DISABLED. Production returned `(#194) param adbatch has too few
 * elements`: this implementation posts to `act_/async_batch_requests` with `adbatch`
 * (the batch-CREATE edge, which requires ≥2 sub-requests), but the documented async
 * `/copies` mechanism is the `asyncbatch` param at the version ROOT
 * (`graph.facebook.com/<VERSION>`), with a different poll/result shape. The
 * entity-by-entity path is the reliable one (and self-repairs). Re-enable ONLY after
 * validating the correct `asyncbatch`-at-root wire format against a live v25 ad
 * account. Typed `: boolean` so the gated branch stays reachable for TS/lint.
 */
const ASYNC_DEEPCOPY_ENABLED: boolean = false;

const ASYNC_DEEPCOPY_MAX_CHILDREN = 50;
const ASYNC_POLL_INTERVAL_MS = 2_000;
/** Bounded so the in-request poll leaves budget for a fallback within ~60s maxDuration. */
const ASYNC_POLL_CAP_MS = 40_000;

/**
 * Thrown when an async deep-copy did not finish within the in-request poll budget.
 * The copy is still completing on Meta's side, so the route surfaces a
 * "keep going / refresh shortly" response instead of timing out or starting a
 * duplicate fallback.
 */
export class DuplicateInProgressError extends Error {
  readonly requestSetId?: string;
  constructor(requestSetId?: string) {
    super("A duplicação está em andamento na Meta.");
    this.name = "DuplicateInProgressError";
    this.requestSetId = requestSetId;
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Count the copyable children (ad sets + ads) in a fetched campaign tree. Returns
 * `estimable: false` when a read limit (200) is saturated — we then can't be sure
 * the subtree fits the async cap, so the caller uses entity-by-entity.
 */
function countTreeChildren(tree: CampaignTree): {
  count: number;
  estimable: boolean;
} {
  const adsets = tree.adsets?.data ?? [];
  if (adsets.length >= 200) {
    return { count: Number.POSITIVE_INFINITY, estimable: false };
  }
  let count = adsets.length;
  for (const adset of adsets) {
    const ads = adset.ads?.data ?? [];
    if (ads.length >= 200) {
      return { count: Number.POSITIVE_INFINITY, estimable: false };
    }
    count += ads.length;
  }
  return { count, estimable: true };
}

type AsyncCopyOutcome =
  | { status: "done"; copiedId: string }
  | { status: "in_progress"; requestSetId: string }
  | { status: "fallback" };

/** Submit a single deep_copy as an async batch job; returns the request-set id. */
async function submitAsyncDeepCopy(args: {
  accountId: string;
  sourceId: string;
  accessToken: string;
  extraBody?: Record<string, string>;
}): Promise<string | undefined> {
  const subBody = new URLSearchParams({
    deep_copy: "true",
    status_option: STATUS_OPTION,
    rename_options: NO_RENAME,
    ...(args.extraBody ?? {}),
  });
  const adbatch = JSON.stringify([
    {
      name: "deep_copy",
      relative_url: `${args.sourceId}/copies`,
      body: subBody.toString(),
    },
  ]);
  const res = await withMetaRetry(() =>
    metaApiCall<{ id?: string }>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${args.accountId}/async_batch_requests`,
      params: "",
      body: new URLSearchParams({ name: "deep_copy", adbatch }),
      accessToken: args.accessToken,
    }),
  );
  return res.id;
}

/** Read the copied object id out of the completed async request set's results. */
async function readAsyncCopiedId(
  requestSetId: string,
  copiedIdField: "copied_campaign_id" | "copied_adset_id",
  accessToken: string,
): Promise<string | undefined> {
  try {
    const res = await metaApiCall<{
      data?: Array<{ status?: string; result?: unknown }>;
    }>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${requestSetId}/requests`,
      params: "fields=id,status,result",
      accessToken,
    });
    for (const req of res.data ?? []) {
      const parsed =
        typeof req.result === "string" ? safeJsonParse(req.result) : req.result;
      const obj = parsed as Record<string, unknown> | null | undefined;
      const id = obj?.[copiedIdField] ?? obj?.["id"];
      if (typeof id === "string" && id) return id;
      if (typeof id === "number") return String(id);
    }
  } catch {
    /* fall through to undefined */
  }
  return undefined;
}

type AsyncPollResult =
  | { status: "success"; copiedId: string }
  | { status: "failure"; copiedId?: string }
  | { status: "timeout" };

/** Poll the async request set until completion or the in-request budget runs out. */
async function pollAsyncDeepCopy(
  requestSetId: string,
  copiedIdField: "copied_campaign_id" | "copied_adset_id",
  accessToken: string,
): Promise<AsyncPollResult> {
  const deadline = Date.now() + ASYNC_POLL_CAP_MS;
  for (;;) {
    await sleep(ASYNC_POLL_INTERVAL_MS);
    if (Date.now() >= deadline) return { status: "timeout" };
    let set: { is_completed?: boolean; error_count?: number } | undefined;
    try {
      set = await metaApiCall<{ is_completed?: boolean; error_count?: number }>({
        domain: "FACEBOOK",
        method: "GET",
        path: requestSetId,
        params: "fields=is_completed,error_count,success_count",
        accessToken,
      });
    } catch {
      continue; // transient read error — keep polling until the deadline
    }
    if (!set.is_completed) continue;
    const copiedId = await readAsyncCopiedId(
      requestSetId,
      copiedIdField,
      accessToken,
    );
    if ((set.error_count ?? 0) > 0 || !copiedId) {
      return { status: "failure", copiedId };
    }
    return { status: "success", copiedId };
  }
}

/**
 * Try to deep-copy `sourceId` (campaign or ad set) as one async job Meta paces
 * itself. On success returns the new id; if it can't finish in the poll budget it
 * reports `in_progress` (the copy keeps running on Meta); on any failure it deletes
 * the partial copy (so we never double-create) and reports `fallback` for the
 * caller to run entity-by-entity. If the partial can't be confirmed deleted, it
 * aborts with an orphan report rather than risk a duplicate.
 */
async function tryAsyncDeepCopy(args: {
  accountId: string;
  sourceId: string;
  copiedIdField: "copied_campaign_id" | "copied_adset_id";
  accessToken: string;
  extraBody?: Record<string, string>;
}): Promise<AsyncCopyOutcome> {
  let requestSetId: string | undefined;
  try {
    requestSetId = await submitAsyncDeepCopy({
      accountId: args.accountId,
      sourceId: args.sourceId,
      accessToken: args.accessToken,
      extraBody: args.extraBody,
    });
  } catch {
    return { status: "fallback" }; // submit rejected → nothing created
  }
  if (!requestSetId) return { status: "fallback" };

  const poll = await pollAsyncDeepCopy(
    requestSetId,
    args.copiedIdField,
    args.accessToken,
  );
  if (poll.status === "success") return { status: "done", copiedId: poll.copiedId };
  if (poll.status === "timeout") return { status: "in_progress", requestSetId };

  // Failure: remove any partial copy before falling back, else we'd double-create.
  if (poll.copiedId) {
    let cleaned = false;
    try {
      await withMetaRetry(() =>
        metaApiCall<{ success?: boolean }>({
          domain: "FACEBOOK",
          method: "DELETE",
          path: poll.copiedId as string,
          params: "",
          accessToken: args.accessToken,
        }),
      );
      cleaned = true;
    } catch {
      cleaned = false;
    }
    if (!cleaned) {
      throw new DuplicateAtomicError({
        message:
          "A cópia assíncrona falhou e a cópia parcial não pôde ser removida automaticamente.",
        solution: `Remova o objeto ${poll.copiedId} no Gerenciador de Anúncios e tente duplicar novamente.`,
        rolledBack: false,
        orphanIds: [poll.copiedId],
      });
    }
  }
  return { status: "fallback" };
}

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
  /** Campaign objective (e.g. OUTCOME_SALES); gates pre-emptive sales-URL injection. */
  objective?: string;
  /** ASC/AAC marker (AUTOMATED_SHOPPING_ADS / SMART_APP_PROMOTION); used to refuse copy on v25. */
  smart_promotion_type?: string;
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

/**
 * True for permanent rejections the ad-set REBUILD provably cannot resolve (Page
 * permission, CBO budget — see `REBUILD_UNFIXABLE_SUBCODES`). When native `/copies`
 * fails this way we rethrow the original error instead of attempting a rebuild that
 * would fail identically — saving a second 4xx against the app's Meta error budget.
 */
function isRebuildUnfixable(err: unknown): boolean {
  const sub = graphErrorSubcode(err);
  return sub != null && REBUILD_UNFIXABLE_SUBCODES.has(sub);
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

/** A single deprecated detailed-targeting interest swapped for Meta's alternative. */
export type InterestReplacement = {
  fromId: string;
  fromName?: string;
  toId: string;
  toName?: string;
};

/** All interest swaps applied to one rebuilt ad set, for surfacing to the user. */
export type ReplacedInterestsItem = {
  sourceAdsetId: string;
  sourceAdsetName?: string;
  replacements: InterestReplacement[];
};

/** Stable labels for the non-destructive creative adjustments we apply on copy. */
export type CreativeRepairLabel =
  | "standard-enhancements"
  | "image-crop"
  | "promotion-url";

/** An ad whose creative was adjusted (for compatibility) before/while copying. */
export type RepairedCreativeItem = {
  sourceAdId: string;
  sourceAdName?: string;
  repairs: CreativeRepairLabel[];
};

/** An ad set that was RECONSTRUCTED (not natively copied) — its config was adjusted. */
export type RebuiltAdsetItem = {
  sourceAdsetId: string;
  sourceAdsetName?: string;
  /** A past lifetime flight window was moved to the future (the copy's dates differ). */
  scheduleShifted: boolean;
};

export type DuplicateResult = {
  id: string;
  name: string;
  sourceName: string;
  /** Ads Meta refused to copy for an un-fixable, ad-specific reason. */
  skippedAds?: SkippedItem[];
  /** Ad sets dropped because every one of their ads was skipped. */
  skippedAdsets?: SkippedItem[];
  /**
   * Deprecated detailed-targeting interests (subcode 1870247) that were swapped for
   * Meta's own recommended alternatives during an ad-set rebuild. Surfaced so the user
   * is told exactly which interests changed and to what (delivery is affected).
   */
  replacedInterests?: ReplacedInterestsItem[];
  /**
   * Ads whose creative was non-destructively adjusted to copy under the current API
   * (deprecated image crop stripped/deduped, deprecated enhancements stripped, sales
   * link applied). Surfaced so the user knows the creative was modified for compatibility.
   */
  repairedCreatives?: RepairedCreativeItem[];
  /**
   * Ad sets that were RECONSTRUCTED instead of natively copied (their native copy was
   * refused — e.g. missing `advantage_audience`, Explore-Home without Explore, a past
   * lifetime window). The rebuild sanitizes targeting and may shift the flight dates, so
   * the user is told to review the reconstructed ad set.
   */
  rebuiltAdsets?: RebuiltAdsetItem[];
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
    await withMetaRetry(() =>
      metaApiCall<{ success?: boolean }>({
        domain: "FACEBOOK",
        method: "DELETE",
        path: objectId,
        params: "",
        accessToken,
      }),
    );
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
  await withMetaRetry(() =>
    metaApiCall<{ success?: boolean; id?: string }>({
      domain: "FACEBOOK",
      method: "POST",
      path: objectId,
      params: "",
      body: new URLSearchParams({ name }),
      accessToken,
    }),
  );
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
      "fields=name,objective,smart_promotion_type,daily_budget,lifetime_budget,adsets.limit(200){id,name,ads.limit(200){id,name}}",
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
  const res = await withMetaRetry(() =>
    metaApiCall<CopyResponse>({
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
    }),
  );
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
 * 3. Inject `targeting_automation.advantage_audience: 0` when absent. Meta requires
 *    this flag (0|1) on every ad-set POST since v23.0 (subcode 1870227 "Advantage
 *    audience required"); legacy ad sets read back WITHOUT it, which is why both the
 *    native `/copies` and a naive rebuild are refused. `0` = manual (the source's
 *    explicit audience stays a hard constraint) — faithful to the original and always
 *    accepted; `1` would expand delivery AND require `targeting_relaxation_types` when
 *    manual age/gender/custom audiences are present. An existing value is preserved.
 *
 * Everything else (audience names, geo `region_id`/`primary_city_id`,
 * `flexible_spec`) is preserved verbatim — Meta accepts its own read-back. The
 * `validate_only` gate in `rebuildAdsetInto` catches any residual read-only field,
 * so this list can grow as cases surface.
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
  const targetingAutomation = (t.targeting_automation ?? {}) as Record<
    string,
    unknown
  >;
  if (targetingAutomation.advantage_audience == null) {
    t.targeting_automation = { ...targetingAutomation, advantage_audience: 0 };
  }
  return t;
}

/**
 * Meta subcode 1870247: the ad set's detailed targeting includes interests Meta has
 * DEPRECATED (merged into broader ones). Meta refuses the spec but returns the exact
 * replacements in `error_user_msg`; the rebuild swaps each deprecated interest for
 * Meta's recommended alternative and retries, surfacing the swaps to the user.
 */
const DEPRECATED_DETAILED_TARGETING = 1870247;
/** Bound the replace→re-validate loop in case Meta reveals deprecated interests in waves. */
const MAX_INTEREST_REPLACE_ATTEMPTS = 3;

/**
 * Parse the deprecated→alternative interest map from a 1870247 error. Meta embeds it
 * as a JSON array in `error_user_msg` (there is no structured field), e.g.
 * `[{"deprecated_interest_id":"…","alternative_interest_id":"…", …}]`. We extract the
 * bracketed JSON (locale-independent — the surrounding sentence is localized) and map
 * deprecated id → alternative. Returns null when the error isn't a parseable 1870247.
 */
function parseInterestAlternatives(
  err: unknown,
): Map<string, { toId: string; toName?: string; fromName?: string }> | null {
  if (!(err instanceof GraphApiError)) return null;
  if (err.errorReturn.data?.errorSubcode !== DEPRECATED_DETAILED_TARGETING) return null;
  const msg = err.errorReturn.data?.errorUserMsg ?? "";
  const match = msg.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const map = new Map<string, { toId: string; toName?: string; fromName?: string }>();
  for (const entry of parsed) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const from = e.deprecated_interest_id;
    const to = e.alternative_interest_id;
    if (from != null && to != null) {
      map.set(String(from), {
        toId: String(to),
        toName:
          typeof e.alternative_interest_name === "string"
            ? e.alternative_interest_name
            : undefined,
        fromName:
          typeof e.deprecated_interest_name === "string"
            ? e.deprecated_interest_name
            : undefined,
      });
    }
  }
  return map.size ? map : null;
}

/**
 * Return a copy of `targeting` with every deprecated interest swapped for its Meta
 * alternative, plus the list of swaps made. Replaces `interests` arrays wherever they
 * appear (top-level, each `flexible_spec[]`, `exclusions`) and de-duplicates by id
 * afterwards (several deprecated interests can map to the same alternative, or the
 * alternative may already be present). Never mutates the input.
 */
function replaceDeprecatedInterests(
  targeting: Record<string, unknown> | undefined,
  alternatives: Map<string, { toId: string; toName?: string; fromName?: string }>,
): { targeting: Record<string, unknown>; replacements: InterestReplacement[] } {
  const cloned = JSON.parse(JSON.stringify(targeting ?? {})) as Record<string, unknown>;
  const replacements: InterestReplacement[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (key === "interests" && Array.isArray(value)) {
        const seen = new Set<string>();
        const out: Array<Record<string, unknown>> = [];
        for (const raw of value) {
          const interest = (raw ?? {}) as Record<string, unknown>;
          const id = String(interest.id ?? "");
          const alt = alternatives.get(id);
          const next = alt
            ? { id: alt.toId, name: alt.toName ?? interest.name }
            : interest;
          if (alt) {
            replacements.push({
              fromId: id,
              fromName:
                typeof interest.name === "string" ? interest.name : alt.fromName,
              toId: alt.toId,
              toName: alt.toName,
            });
          }
          const nextId = String((next as Record<string, unknown>).id ?? "");
          if (nextId && seen.has(nextId)) continue;
          if (nextId) seen.add(nextId);
          out.push(next as Record<string, unknown>);
        }
        obj[key] = out;
      } else {
        walk(value);
      }
    }
  };

  walk(cloned);
  return { targeting: cloned, replacements };
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
 * Fallback when native ad-set `/copies` is (or would be) permanently refused —
 * e.g. the source targeting is invalid by current rules (Explore Home without
 * Explore) or missing the now-mandatory `advantage_audience` flag. The `/copies`
 * endpoint can't override targeting and the source can't be edited (it may belong
 * to an ended campaign), so we reconstruct the ad set: sanitize the (pre-fetched)
 * source and create it in the target campaign.
 *
 * Gated by `validate_only`: if Meta won't accept the reconstructed ad set we throw
 * the original copy rejection (reactive path) or the validation error (pre-emptive
 * path) so the caller rolls back exactly as before — the rebuild can only ever turn
 * a failure into a success, never mask one. The SOURCE ad set is never modified;
 * ads are copied in by the caller. The source is read ONCE by the caller and passed
 * in, so a pre-detected rebuild costs no extra GET.
 */
async function rebuildAdsetInto(args: {
  accountId: string;
  targetCampaignId: string;
  accessToken: string;
  isCBO: boolean;
  campaignLifetime: boolean;
  /** Pre-fetched source ad set (full `ADSET_REBUILD_FIELDS`). */
  source: AdsetFull;
  /** Present only on the reactive path (a native `/copies` was tried and failed). */
  originalError?: unknown;
}): Promise<{
  id: string;
  replacedInterests: InterestReplacement[];
  scheduleShifted: boolean;
}> {
  const {
    accountId,
    targetCampaignId,
    accessToken,
    isCBO,
    campaignLifetime,
    source,
    originalError,
  } = args;
  const act = formatAccountId(accountId);

  const effectiveLifetime = isCBO
    ? campaignLifetime
    : hasPositiveMinorUnits(source.lifetime_budget);

  // A lifetime ad set whose source flight window has already passed is given a fresh
  // FUTURE window (see `computeRebuildSchedule`) — surface that the copy's dates differ.
  const srcEnd = source.end_time ? Date.parse(source.end_time) : NaN;
  const scheduleShifted =
    effectiveLifetime &&
    (Number.isNaN(srcEnd) || srcEnd <= Date.now() + MIN_FLIGHT_MS);

  // Working source whose targeting we may rewrite when Meta rejects deprecated
  // interests (1870247) and hands back the alternatives. Bounded loop: each rejection
  // carries the full alternative list, so one pass usually clears it.
  let workingSource = source;
  const replacedInterests: InterestReplacement[] = [];
  let body = buildRebuildAdsetBody({
    source: workingSource,
    targetCampaignId,
    isCBO,
    effectiveLifetime,
  });

  for (let attempt = 0; ; attempt += 1) {
    const validateBody = new URLSearchParams(body);
    validateBody.set("execution_options", VALIDATE_ONLY);
    try {
      await withMetaRetry(() =>
        metaApiCall<{ success?: boolean }>({
          domain: "FACEBOOK",
          method: "POST",
          path: `${act}/adsets`,
          params: "",
          body: validateBody,
          accessToken,
        }),
      );
      break; // valid → create
    } catch (validateErr) {
      // Deprecated detailed-targeting interests (1870247): swap each for Meta's own
      // alternative (returned in the error) and re-validate. Any other rejection — or
      // exhausting the attempts — surfaces the original copy rejection (reactive path)
      // or the validation error (pre-emptive path) so the caller rolls back as before.
      const alternatives =
        attempt < MAX_INTEREST_REPLACE_ATTEMPTS
          ? parseInterestAlternatives(validateErr)
          : null;
      if (alternatives) {
        const { targeting, replacements } = replaceDeprecatedInterests(
          workingSource.targeting,
          alternatives,
        );
        if (replacements.length > 0) {
          replacedInterests.push(...replacements);
          workingSource = { ...workingSource, targeting };
          body = buildRebuildAdsetBody({
            source: workingSource,
            targetCampaignId,
            isCBO,
            effectiveLifetime,
          });
          continue;
        }
      }
      throw originalError ?? validateErr;
    }
  }

  const created = await withMetaRetry(() =>
    metaApiCall<{ id?: string }>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${act}/adsets`,
      params: "",
      body,
      accessToken,
    }),
  );
  if (!created.id) throw missingCopyIdError("do conjunto");
  return { id: created.id, replacedInterests, scheduleShifted };
}

/**
 * Known targeting markers that make a native ad-set `/copies` fail Meta's
 * re-validation (a 400 that counts against the app's error budget). We pre-detect
 * these from the source's targeting and rebuild directly instead of attempting —
 * and failing — the native copy. Mirrors exactly what `sanitizeTargetingForRebuild`
 * repairs:
 * - missing `targeting_automation.advantage_audience` (subcode 1870227, mandatory
 *   on every ad-set POST since v23.0);
 * - Instagram `explore_home` placement without `explore` (subcode 2490392).
 * Unknown blockers aren't detectable here, so the caller still falls back to a
 * rebuild reactively if a native copy fails for another permanent reason.
 */
function adsetNeedsRebuild(
  targeting: Record<string, unknown> | undefined,
): boolean {
  if (!targeting) return false; // can't tell → let the native copy be attempted
  const ta = targeting.targeting_automation as
    | Record<string, unknown>
    | undefined;
  if (ta?.advantage_audience == null) return true;
  const positions = targeting.instagram_positions;
  if (
    Array.isArray(positions) &&
    positions.includes("explore_home") &&
    !positions.includes("explore")
  ) {
    return true;
  }
  return false;
}

/** Stay safely under Meta's `?ids=` multi-read cap. */
const ADSET_BATCH_SIZE = 50;

/**
 * Batch-read many ad sets' rebuild fields in one request each (Meta's `?ids=`
 * multi-read, chunked at `ADSET_BATCH_SIZE`) instead of one GET per ad set — Meta
 * recommends multi-id reads. Feeds the pre-detection + rebuild for a whole campaign
 * from a single call. A chunk that fails is skipped — those ad sets fall back to an
 * individual read in `copyOrRebuildAdsetInto`.
 */
async function fetchAdsetsById(
  adsetIds: string[],
  accessToken: string,
): Promise<Map<string, AdsetFull>> {
  const byId = new Map<string, AdsetFull>();
  for (let i = 0; i < adsetIds.length; i += ADSET_BATCH_SIZE) {
    const chunk = adsetIds.slice(i, i + ADSET_BATCH_SIZE);
    try {
      const res = await metaApiCall<Record<string, AdsetFull & { id?: string }>>({
        domain: "FACEBOOK",
        method: "GET",
        path: "",
        params: `ids=${chunk.join(",")}&fields=${ADSET_REBUILD_FIELDS}`,
        accessToken,
      });
      for (const [adsetId, node] of Object.entries(res ?? {})) {
        if (node) byId.set(adsetId, node);
      }
    } catch {
      // Whole chunk unreadable — those ad sets read individually as a fallback.
    }
  }
  return byId;
}

/**
 * Copy an ad set natively, falling back to a `validate_only`-gated rebuild. The
 * source ad set's fields are read ONCE — passed in (`prefetchedSource`, from a bulk
 * `?ids=` read for a whole campaign) or read here for a single-ad-set duplication —
 * and feed BOTH the pre-detection and the rebuild: if its targeting has a known
 * re-validation blocker we rebuild directly (skipping a native `/copies` that would
 * 400 — Meta counts those against the app's error budget); otherwise we copy natively
 * and only rebuild reactively for an unforeseen permanent failure.
 */
async function copyOrRebuildAdsetInto(args: {
  accountId: string;
  sourceAdsetId: string;
  targetCampaignId: string;
  accessToken: string;
  isCBO: boolean;
  campaignLifetime: boolean;
  /** Pre-read source (from a bulk `?ids=` read); avoids a per-ad-set GET. */
  prefetchedSource?: AdsetFull;
}): Promise<{
  id: string;
  replacedInterests: InterestReplacement[];
  /** True when the ad set was RECONSTRUCTED instead of natively copied. */
  rebuilt: boolean;
  /** True when a past lifetime flight window was moved to the future. */
  scheduleShifted: boolean;
}> {
  const {
    accountId,
    sourceAdsetId,
    targetCampaignId,
    accessToken,
    isCBO,
    campaignLifetime,
  } = args;

  // Reuse the bulk-read source when available; otherwise read this ad set once.
  const source =
    args.prefetchedSource ??
    (await metaApiCall<AdsetFull>({
      domain: "FACEBOOK",
      method: "GET",
      path: sourceAdsetId,
      params: `fields=${ADSET_REBUILD_FIELDS}`,
      accessToken,
    }));

  if (adsetNeedsRebuild(source.targeting)) {
    // Known blocker → go straight to rebuild; never fire the doomed native copy.
    const rebuiltResult = await rebuildAdsetInto({
      accountId,
      targetCampaignId,
      accessToken,
      isCBO,
      campaignLifetime,
      source,
    });
    return { ...rebuiltResult, rebuilt: true };
  }

  let copiedAdsetId: string | undefined;
  try {
    copiedAdsetId = await copyAdsetInto(
      sourceAdsetId,
      targetCampaignId,
      accessToken,
    );
  } catch (copyErr) {
    // Only rebuild for a permanent failure the rebuild can actually fix. Transient
    // failures (a retry would copy natively) and rebuild-unfixable rejections (Page
    // permission, CBO budget) rethrow immediately — the latter so we don't spend a
    // SECOND doomed 4xx on a rebuild that recreates the very same blocker.
    if (!isPermanentGraphFailure(copyErr) || isRebuildUnfixable(copyErr)) throw copyErr;
    // Unforeseen permanent failure the rebuild can address (targeting re-validation) —
    // rebuild reactively, reusing the fetched source.
    const rebuiltResult = await rebuildAdsetInto({
      accountId,
      targetCampaignId,
      accessToken,
      isCBO,
      campaignLifetime,
      source,
      originalError: copyErr,
    });
    return { ...rebuiltResult, rebuilt: true };
  }
  if (!copiedAdsetId) throw missingCopyIdError("do conjunto");
  return {
    id: copiedAdsetId,
    replacedInterests: [],
    rebuilt: false,
    scheduleShifted: false,
  };
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

  const res = await withMetaRetry(() =>
    metaApiCall<CopyResponse>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${sourceAdId}/copies`,
      params: "",
      body,
      accessToken,
    }),
  );
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
    link_data?: {
      link?: string;
      call_to_action?: GraphCta;
      image_crops?: Record<string, unknown>;
      [key: string]: unknown;
    };
    video_data?: { call_to_action?: GraphCta; [key: string]: unknown };
    [key: string]: unknown;
  };
  asset_feed_spec?: {
    link_urls?: Array<{ website_url?: string; [key: string]: unknown }>;
    images?: Array<{
      image_crops?: Record<string, unknown>;
      [key: string]: unknown;
    }>;
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
 * Fetch the source ad's creative with the fields the repair patches need, in ONE
 * GET (`ad{creative{...}}`). Returns null when it can't be read. Reactive fallback
 * for ads whose creative wasn't part of a bulk pre-read.
 */
async function getRepairableCreative(
  sourceAdId: string,
  accessToken: string,
): Promise<GraphCreativeShape | null> {
  try {
    const ad = await metaApiCall<{ creative?: GraphCreativeShape }>({
      domain: "FACEBOOK",
      method: "GET",
      path: sourceAdId,
      params: `fields=creative{${CREATIVE_PREFETCH_FIELDS}}`,
      accessToken,
    });
    return ad.creative ?? null;
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

/** True if a crop map contains any crop key Meta has deprecated. */
function hasDeprecatedCropKey(crops: Record<string, unknown>): boolean {
  for (const key of Object.keys(crops)) {
    if (DEPRECATED_IMAGE_CROP_KEYS.has(key)) return true;
  }
  return false;
}

/** A copy of `crops` without the deprecated keys, or undefined if nothing remains. */
function withoutDeprecatedCropKeys(
  crops: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(crops)) {
    if (!DEPRECATED_IMAGE_CROP_KEYS.has(key)) kept[key] = value;
  }
  return Object.keys(kept).length ? kept : undefined;
}

/** Union two `adlabels` arrays, de-duplicating by label name (keeps full label objects). */
function mergeAdlabels(
  a: unknown,
  b: unknown,
): Array<{ name?: string; [key: string]: unknown }> {
  const out: Array<{ name?: string; [key: string]: unknown }> = [];
  const seen = new Set<string>();
  const all = [
    ...(Array.isArray(a) ? a : []),
    ...(Array.isArray(b) ? b : []),
  ] as Array<{ name?: string; [key: string]: unknown }>;
  for (const label of all) {
    const name = label?.name;
    if (typeof name === "string") {
      if (seen.has(name)) continue;
      seen.add(name);
    }
    out.push(label);
  }
  return out;
}

/**
 * Collapse `asset_feed_spec.images` that are identical EXCEPT for their `adlabels`,
 * unioning the adlabels onto a single surviving image. After a deprecated crop is
 * stripped, two placement variants of the same image (same hash, the crop was their
 * only difference) become identical — and Meta rejects duplicate asset values
 * (subcode 1815629). Merging them keeps ONE image carrying both adlabels, so the
 * `asset_customization_rules` (which key on adlabel) keep resolving without any rule
 * rewrite. A no-op when no two images collapse.
 */
function dedupeImagesByContent(
  images: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byContent = new Map<string, Record<string, unknown>>();
  for (const img of images) {
    const { adlabels, ...rest } = img;
    const key = JSON.stringify(rest);
    const existing = byContent.get(key);
    if (existing) {
      existing.adlabels = mergeAdlabels(existing.adlabels, adlabels);
    } else {
      byContent.set(key, { ...img });
    }
  }
  return [...byContent.values()];
}

/**
 * Patch that removes deprecated image crop keys (e.g. `191x100`, subcode 2490085)
 * from the creative's `image_crops`, so the copy uses Meta's flexible image aspect
 * ratio instead of a key the latest API version rejects. Handles both creative
 * shapes — `asset_feed_spec.images[]` and `object_story_spec.link_data` — and drops
 * a now-empty `image_crops` entirely. Returns null when no deprecated key is present,
 * so creatives without one are NEVER modified (no fidelity change, no regression).
 */
function buildStripDeprecatedCropPatch(
  creative: GraphCreativeShape,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  const afs = creative.asset_feed_spec;
  if (
    afs?.images?.some(
      (img) => img?.image_crops && hasDeprecatedCropKey(img.image_crops),
    )
  ) {
    const cloned = JSON.parse(JSON.stringify(afs)) as NonNullable<
      GraphCreativeShape["asset_feed_spec"]
    >;
    for (const img of cloned.images ?? []) {
      if (img?.image_crops) {
        const cleaned = withoutDeprecatedCropKeys(img.image_crops);
        if (cleaned) img.image_crops = cleaned;
        else delete img.image_crops;
      }
    }
    // Stripping the crop can leave two images identical (their crop was the only
    // difference); Meta rejects duplicate asset values (1815629). Collapse them into
    // one image carrying both adlabels so the customization rules still resolve.
    if (cloned.images) {
      cloned.images = dedupeImagesByContent(
        cloned.images as Array<Record<string, unknown>>,
      ) as typeof cloned.images;
    }
    patch.asset_feed_spec = cloned;
  }

  const linkData = creative.object_story_spec?.link_data;
  if (linkData?.image_crops && hasDeprecatedCropKey(linkData.image_crops)) {
    const cloned = JSON.parse(
      JSON.stringify(creative.object_story_spec),
    ) as NonNullable<GraphCreativeShape["object_story_spec"]>;
    if (cloned.link_data?.image_crops) {
      const cleaned = withoutDeprecatedCropKeys(cloned.link_data.image_crops);
      if (cleaned) cloned.link_data.image_crops = cleaned;
      else delete cloned.link_data.image_crops;
    }
    patch.object_story_spec = cloned;
  }

  return Object.keys(patch).length ? patch : null;
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
  if (subcode === DEPRECATED_IMAGE_CROP) {
    return buildStripDeprecatedCropPatch(creative);
  }
  if (URL_REQUIRED_SUBCODES.has(subcode)) {
    const url = extractCreativeUrl(creative) ?? fallbackPromotionUrl ?? null;
    return url ? buildPromotionUrlPatch(creative, url) : null;
  }
  return null;
}

const CREATIVE_PREFETCH_FIELDS =
  "call_to_action,source_instagram_media_id,degrees_of_freedom_spec,object_story_spec,asset_feed_spec";
/** Stay safely under Meta's `?ids=` multi-read cap. */
const CREATIVE_BATCH_SIZE = 50;

/**
 * Batch-read many ads' creatives via Meta's `?ids=` multi-read (chunked at
 * `CREATIVE_BATCH_SIZE`) — one request per chunk instead of one GET per ad (Meta
 * recommends multi-id reads). Used to PRE-DETECT creative problems and fix them on
 * the first copy, so we never spend a 400 (which counts against the app's Meta error
 * budget) just to learn a creative needs repair. A chunk that fails is skipped —
 * those ads degrade to the reactive repair, so duplication stays correct.
 */
async function fetchCreativesByAdId(
  adIds: string[],
  accessToken: string,
): Promise<Map<string, GraphCreativeShape>> {
  const byAdId = new Map<string, GraphCreativeShape>();
  for (let i = 0; i < adIds.length; i += CREATIVE_BATCH_SIZE) {
    const chunk = adIds.slice(i, i + CREATIVE_BATCH_SIZE);
    try {
      const res = await metaApiCall<
        Record<string, { id?: string; creative?: GraphCreativeShape }>
      >({
        domain: "FACEBOOK",
        method: "GET",
        path: "",
        params: `ids=${chunk.join(",")}&fields=id,creative{${CREATIVE_PREFETCH_FIELDS}}`,
        accessToken,
      });
      for (const [adId, node] of Object.entries(res ?? {})) {
        if (node?.creative) byAdId.set(adId, node.creative);
      }
    } catch {
      // Whole chunk unreadable — leave these ads to the reactive repair path.
    }
  }
  return byAdId;
}

/** Default skip reason when Meta marks a media boost-ineligible without detail. */
const BOOST_INELIGIBLE_FALLBACK_REASON =
  "Não é possível turbinar este anúncio: a mídia do Instagram não está elegível para anúncios (por exemplo, reels com música protegida por direitos autorais).";
/** Stay safely under Meta's `?ids=` multi-read cap. */
const BOOST_ELIGIBILITY_BATCH_SIZE = 50;

/** Unique `source_instagram_media_id`s across the pre-fetched creatives (IG-post boosts). */
function collectSourceMediaIds(
  creatives: Map<string, GraphCreativeShape>,
): string[] {
  const ids = new Set<string>();
  for (const creative of creatives.values()) {
    const mediaId = creative.source_instagram_media_id;
    if (mediaId) ids.add(String(mediaId));
  }
  return [...ids];
}

/**
 * Ask Meta which of these Instagram media are NOT eligible to be promoted as ads,
 * batched via `?ids=` (Meta recommends multi-id reads). An IG-post-boost creative
 * whose `source_instagram_media_id` is boost-ineligible (most commonly a reel with
 * copyrighted music) WILL 400 with subcode 2875030 on `/copies` — and Meta counts
 * every such 400 against the app's error budget. Reading `boost_eligibility_info`
 * up front (a 200, not an error) lets the caller PRE-SKIP those ads instead of
 * spending one 400 per reel to learn the same thing.
 *
 * Best-effort and non-regressing: `boost_eligibility_info` is a Facebook-Login-only
 * field, so any read failure or an absent verdict yields NO entry — those ads fall
 * through to the existing attempt-then-reactive-skip with no behavior change. Only a
 * definitive `eligible_to_boost === false` is recorded (validated live: every
 * copyable ad reported `true`, so this never produces a false skip). Returns a map of
 * ineligible media id → Meta's reason; makes no call when there are no IG-post boosts.
 */
async function fetchBoostIneligibleMedia(
  mediaIds: string[],
  accessToken: string,
): Promise<Map<string, string>> {
  const ineligible = new Map<string, string>();
  if (mediaIds.length === 0) return ineligible;
  for (let i = 0; i < mediaIds.length; i += BOOST_ELIGIBILITY_BATCH_SIZE) {
    const chunk = mediaIds.slice(i, i + BOOST_ELIGIBILITY_BATCH_SIZE);
    try {
      const res = await metaApiCall<
        Record<
          string,
          {
            boost_eligibility_info?: {
              eligible_to_boost?: boolean;
              boost_ineligible_reason?: string;
            };
          }
        >
      >({
        domain: "FACEBOOK",
        method: "GET",
        path: "",
        params: `ids=${chunk.join(",")}&fields=boost_eligibility_info`,
        accessToken,
      });
      for (const [mediaId, node] of Object.entries(res ?? {})) {
        const bei = node?.boost_eligibility_info;
        // Only a definitive `false` pre-skips. `true`, absent, or an unreadable
        // verdict leaves the ad to the existing copy path (never a false skip).
        if (bei?.eligible_to_boost === false) {
          const detail = bei.boost_ineligible_reason?.trim();
          ineligible.set(
            mediaId,
            detail
              ? `Não é possível turbinar este anúncio: ${detail}`
              : BOOST_INELIGIBLE_FALLBACK_REASON,
          );
        }
      }
    } catch {
      // Field is Facebook-Login-only / media unreadable for this token — leave the
      // whole chunk out; those ads degrade to the reactive skip. A pre-check must
      // never fail the duplication.
    }
  }
  return ineligible;
}

/**
 * Decide whether to pre-shape the destination URL into a SALES ad's creative to
 * pre-empt the CTA-URL requirement (2446383/2061015) on the first copy, matching the
 * reactive repair's shape but applied surgically per creative type:
 * - `link_data` / `video_data` → override only when the CTA actually lacks the link
 *   (so already-correct creatives keep full fidelity via a plain copy);
 * - Instagram-post boosts (`source_instagram_media_id`, no link_data) → re-send the
 *   top-level `call_to_action` (a minimal, safe override) — these sales copies 400
 *   without it even when the CTA already carries the link (observed live);
 * - carousels (`asset_feed_spec.link_urls`) → left to the reactive repair so distinct
 *   per-card URLs aren't clobbered;
 * - no URL anywhere and no fallback → handled by the pre-flight (`someCreativeNeedsUrl`).
 */
function preemptiveUrlPatch(
  creative: GraphCreativeShape,
  opts: { isSales: boolean; fallbackPromotionUrl?: string },
): Record<string, unknown> | null {
  if (!opts.isSales) return null;
  if (creative.asset_feed_spec?.link_urls?.length) return null;

  const url = extractCreativeUrl(creative) ?? opts.fallbackPromotionUrl ?? null;
  if (!url) return null;

  const linkData = creative.object_story_spec?.link_data;
  const videoData = creative.object_story_spec?.video_data;
  if (linkData) {
    return linkData.link && !linkData.call_to_action?.value?.link
      ? buildPromotionUrlPatch(creative, url)
      : null;
  }
  if (videoData) {
    return !videoData.call_to_action?.value?.link
      ? buildPromotionUrlPatch(creative, url)
      : null;
  }
  // No link_data/video_data (e.g. an Instagram-post boost): the only override is the
  // top-level call_to_action — minimal and safe — and these sales copies need it
  // re-sent to satisfy the CTA-URL rule.
  return buildPromotionUrlPatch(creative, url);
}

/**
 * `creative_parameters` patch computed BEFORE the first copy from a pre-fetched
 * creative, to pre-empt repairable rejections instead of triggering them:
 * - always strip the deprecated `standard_enhancements` bundle (3858504) when present
 *   (safe, objective-independent);
 * - always strip deprecated image crop keys (2490085, e.g. `191x100`) when present
 *   (safe, objective-independent);
 * - for SALES creatives that would 400 on the CTA-URL requirement, pre-shape the URL
 *   (see `preemptiveUrlPatch`). Returns `{}` when there's nothing to pre-empt.
 *
 * The crop strip and the URL shaping can both rewrite the SAME spec
 * (`asset_feed_spec`/`object_story_spec`), and each emits a full-spec clone — so the
 * URL patch is built from the crop-stripped creative, otherwise its clone would
 * silently drop the crop strip. `standard_enhancements` lives on a different key.
 */
/** The creative-repair label for a repairable subcode (for surfacing to the user). */
function repairLabelForSubcode(subcode: number): CreativeRepairLabel | null {
  if (subcode === STANDARD_ENHANCEMENTS_DEPRECATED) return "standard-enhancements";
  if (subcode === DEPRECATED_IMAGE_CROP) return "image-crop";
  if (URL_REQUIRED_SUBCODES.has(subcode)) return "promotion-url";
  return null;
}

function buildPreemptiveAdPatch(
  creative: GraphCreativeShape,
  opts: { isSales: boolean; fallbackPromotionUrl?: string },
): { patch: Record<string, unknown>; repairs: CreativeRepairLabel[] } {
  const patch: Record<string, unknown> = {};
  const repairs: CreativeRepairLabel[] = [];
  const strip = buildStripStandardEnhancementsPatch(creative);
  if (strip) {
    Object.assign(patch, strip);
    repairs.push("standard-enhancements");
  }
  const cropPatch = buildStripDeprecatedCropPatch(creative);
  if (cropPatch) {
    Object.assign(patch, cropPatch);
    repairs.push("image-crop");
  }
  const urlSource = cropPatch ? { ...creative, ...cropPatch } : creative;
  const urlPatch = preemptiveUrlPatch(urlSource, opts);
  if (urlPatch) {
    Object.assign(patch, urlPatch);
    repairs.push("promotion-url");
  }
  return { patch, repairs };
}

/**
 * True if any pre-fetched creative that we'll actually try to copy has no destination
 * URL anywhere. Creatives whose source media is boost-ineligible are excluded — they'll
 * be pre-skipped, so their missing URL must not trigger a spurious "informe a URL" prompt.
 */
function someCreativeNeedsUrl(
  creatives: Map<string, GraphCreativeShape>,
  boostIneligibleMedia?: Map<string, string>,
): boolean {
  for (const creative of creatives.values()) {
    const mediaId = creative.source_instagram_media_id;
    if (mediaId && boostIneligibleMedia?.has(String(mediaId))) continue;
    if (extractCreativeUrl(creative) == null) return true;
  }
  return false;
}

/**
 * The same "needs a promotion URL" outcome the reactive flow produces (subcode
 * 2446383), but synthesized BEFORE any object is created — so a sales duplication
 * with a URL-less creative and no supplied URL asks for one without first spending a
 * 400 against the app's Meta error budget. `rolledBack: true` because nothing exists
 * to roll back.
 */
function promotionUrlRequiredError(): DuplicateAtomicError {
  return new DuplicateAtomicError({
    statusCode: 400,
    message:
      "Este anúncio de vendas precisa de um link de destino (URL do site) para ser duplicado.",
    solution: "Informe a URL do site/oferta para concluir a duplicação.",
    rolledBack: true,
    needsPromotionUrl: true,
  });
}

/**
 * `copyAdInto` with self-repair, PRE-EMPTIVE when a creative was pre-fetched. From
 * the pre-fetched creative we build a `creative_parameters` patch up front (strip
 * deprecated standard enhancements 3858504; inject a sales URL for 2446383/2061015)
 * and apply it on the FIRST copy — so a fixable creative never 400s. If the copy
 * still hits a repairable rejection we fall back to the reactive loop (reusing the
 * pre-fetched creative, else reading it once), accumulating patches — an ad can hit
 * more than one. The SOURCE ad is never modified. Unrepairable rejections (including
 * skippable copyrighted-music reels) bubble up for the caller to classify.
 */
async function copyAdWithRepair(
  sourceAdId: string,
  targetAdsetId: string,
  accessToken: string,
  opts?: {
    fallbackPromotionUrl?: string;
    /** Creative pre-fetched in bulk; enables pre-emption and avoids a re-read. */
    prefetchedCreative?: GraphCreativeShape | null;
    /** Campaign is a SALES objective — gates pre-emptive URL injection. */
    isSales?: boolean;
  },
): Promise<{ copiedAdId: string | undefined; repairs: CreativeRepairLabel[] }> {
  const fallbackPromotionUrl = opts?.fallbackPromotionUrl;
  const prefetched = opts?.prefetchedCreative ?? null;

  // Pre-emptive patch from the pre-fetched creative (avoids a doomed first copy).
  const pre = prefetched
    ? buildPreemptiveAdPatch(prefetched, {
        isSales: !!opts?.isSales,
        fallbackPromotionUrl,
      })
    : { patch: {} as Record<string, unknown>, repairs: [] as CreativeRepairLabel[] };
  const patch: Record<string, unknown> = pre.patch;
  // Track every creative adjustment applied so the caller can tell the user it changed.
  const repairs = new Set<CreativeRepairLabel>(pre.repairs);

  try {
    const copiedAdId = await copyAdInto(
      sourceAdId,
      targetAdsetId,
      accessToken,
      Object.keys(patch).length ? JSON.stringify(patch) : undefined,
    );
    return { copiedAdId, repairs: [...repairs] };
  } catch (firstErr) {
    const firstSub = graphErrorSubcode(firstErr);
    if (firstSub == null || !REPAIRABLE_AD_SUBCODES.has(firstSub)) throw firstErr;

    const creative =
      prefetched ?? (await getRepairableCreative(sourceAdId, accessToken));
    if (!creative) throw firstErr;

    const applied = new Set<number>();
    let lastErr: unknown = firstErr;

    for (let attempt = 0; attempt < REPAIRABLE_AD_SUBCODES.size + 1; attempt += 1) {
      const sub = graphErrorSubcode(lastErr);
      if (sub == null || !REPAIRABLE_AD_SUBCODES.has(sub) || applied.has(sub)) {
        throw lastErr;
      }
      // Build each repair from the creative with the patches SO FAR applied, so two
      // repairs that rewrite the same spec (e.g. crop strip + URL) compose instead of
      // the later full-spec clone clobbering the earlier one.
      const repairPatch = buildAdRepairPatch(
        sub,
        { ...creative, ...patch },
        fallbackPromotionUrl,
      );
      if (!repairPatch) throw lastErr;
      Object.assign(patch, repairPatch);
      applied.add(sub);
      const label = repairLabelForSubcode(sub);
      if (label) repairs.add(label);
      try {
        const copiedAdId = await copyAdInto(
          sourceAdId,
          targetAdsetId,
          accessToken,
          JSON.stringify(patch),
        );
        return { copiedAdId, repairs: [...repairs] };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }
}

type CopiedAd = { sourceAd: NamedNode; copiedAdId: string };

type AdCopyOutcome =
  | { kind: "ok"; sourceAd: NamedNode; copiedAdId: string; repairs: CreativeRepairLabel[] }
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
  limiter: WriteLimiter,
  creatives: Map<string, GraphCreativeShape>,
  boostIneligibleMedia: Map<string, string>,
  isSales: boolean,
  fallbackPromotionUrl?: string,
): Promise<{
  copiedAds: CopiedAd[];
  skippedAds: SkippedItem[];
  repairedCreatives: RepairedCreativeItem[];
}> {
  const outcomes = await mapWithConcurrency<NamedNode, AdCopyOutcome>(
    sourceAds,
    AD_COPY_CONCURRENCY,
    async (ad) => {
      // Pre-skip IG-post boosts whose source media Meta already says can't be promoted
      // as an ad (e.g. copyrighted-music reels). Copying them would 400 with subcode
      // 2875030 — an error against our budget — for the very skip we can decide here
      // for free from the boost-eligibility read. Degrades gracefully: media absent
      // from the map (read failed, eligible, or no verdict) takes the normal copy path.
      const mediaId = creatives.get(ad.id)?.source_instagram_media_id;
      if (mediaId) {
        const reason = boostIneligibleMedia.get(String(mediaId));
        if (reason) return { kind: "skip", sourceAd: ad, reason };
      }
      try {
        // Paced through the shared limiter so the bounded-parallel copies start
        // spaced out instead of as one burst against Meta's mutation rate limit.
        const { copiedAdId, repairs } = await limiter(() =>
          copyAdWithRepair(ad.id, targetAdsetId, accessToken, {
            fallbackPromotionUrl,
            prefetchedCreative: creatives.get(ad.id) ?? null,
            isSales,
          }),
        );
        if (!copiedAdId) {
          return { kind: "fail", sourceAd: ad, error: missingCopyIdError("do anúncio") };
        }
        tracker.track("ad", copiedAdId);
        return { kind: "ok", sourceAd: ad, copiedAdId, repairs };
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
  const repairedCreatives: RepairedCreativeItem[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === "ok") {
      copiedAds.push({ sourceAd: outcome.sourceAd, copiedAdId: outcome.copiedAdId });
      if (outcome.repairs.length > 0) {
        repairedCreatives.push({
          sourceAdId: outcome.sourceAd.id,
          sourceAdName: outcome.sourceAd.name,
          repairs: outcome.repairs,
        });
      }
    } else if (outcome.kind === "skip") {
      skippedAds.push({
        sourceId: outcome.sourceAd.id,
        sourceName: outcome.sourceAd.name,
        reason: outcome.reason,
      });
    }
  }
  return { copiedAds, skippedAds, repairedCreatives };
}

/**
 * Duplicates a campaign (and its full tree: ad sets + ads). Tries one async
 * deep-copy job first when the subtree fits Meta's async cap (far fewer calls),
 * otherwise — or on any async failure — copies entity-by-entity, which never hits
 * Meta's sync-copy size limit and self-repairs. Only the campaign is renamed;
 * child ad sets/ads keep their source names. The entity path rolls back every
 * created object if a child copy fails.
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

  // Read-only prep, OUTSIDE the rollback scope (nothing created yet). The single
  // tree read also yields the child count (async eligibility) and the ASC/AAC
  // marker that Meta v25 refuses to copy.
  const sourceTree = await getCampaignTree(campaignId, accessToken);
  assertCopyableCampaignType(sourceTree.smart_promotion_type);
  const sourceAdsets = sourceTree.adsets?.data ?? [];
  const sourceName = sourceTree.name ?? "Campanha";
  const isSales = sourceTree.objective === "OUTCOME_SALES";

  // Budget mode of the source campaign decides what a rebuild may set on an ad
  // set: under CBO the budget/bid live on the (already copied) campaign.
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
    sourceName,
    (siblings.data ?? []).map((c) => c.name ?? ""),
  );

  // Bulk-read every ad's creative up front (chunked `?ids=` reads) so ad copies can
  // pre-empt creative repairs on the first attempt — no per-ad 400s.
  const creatives = await fetchCreativesByAdId(
    sourceAdsets.flatMap((a) => a.ads?.data?.map((ad) => ad.id) ?? []),
    accessToken,
  );
  // Boost-eligibility verdict for the IG-post boosts (one `?ids=` read; no call when
  // there are none) so copyrighted-music reels are pre-skipped without spending a 400
  // each on `/copies` (subcode 2875030) against the app's Meta error budget.
  const boostIneligibleMedia = await fetchBoostIneligibleMedia(
    collectSourceMediaIds(creatives),
    accessToken,
  );
  // Pre-flight: a sales campaign with a URL-less creative WILL need a destination
  // URL (2446383). If none was supplied, ask for it now — before creating anything —
  // instead of letting the first ad copy 400 to surface the same prompt. Creatives
  // we'll pre-skip (boost-ineligible) are excluded so they don't force a URL prompt.
  if (
    isSales &&
    !fallbackPromotionUrl &&
    someCreativeNeedsUrl(creatives, boostIneligibleMedia)
  ) {
    throw promotionUrlRequiredError();
  }

  // Bulk-read every ad set's rebuild fields up front (chunked `?ids=`) so the copy
  // loop reuses them — one request instead of a GET per ad set.
  const adsetsById = await fetchAdsetsById(
    sourceAdsets.map((a) => a.id),
    accessToken,
  );

  // Fast path: one async deep-copy job Meta paces internally, replacing dozens of
  // our calls. Used only when the whole subtree fits the async cap; on anything
  // unexpected it cleans up and we fall through to the entity-by-entity floor.
  const { count, estimable } = countTreeChildren(sourceTree);
  if (
    ASYNC_DEEPCOPY_ENABLED &&
    estimable &&
    count > 0 &&
    count <= ASYNC_DEEPCOPY_MAX_CHILDREN
  ) {
    const outcome = await tryAsyncDeepCopy({
      accountId: act,
      sourceId: campaignId,
      copiedIdField: "copied_campaign_id",
      accessToken,
    });
    if (outcome.status === "done") {
      // The copy is committed; a failed rename is cosmetic, so never throw here.
      try {
        await renameObject(outcome.copiedId, newName, accessToken);
      } catch {
        /* keep the successful copy even if the rename is throttled out */
      }
      return { id: outcome.copiedId, name: newName, sourceName };
    }
    if (outcome.status === "in_progress") {
      throw new DuplicateInProgressError(outcome.requestSetId);
    }
    // status === "fallback": partial (if any) already cleaned up → entity path.
  }

  const tracker = new CreatedObjectsTracker();
  const limiter = createWriteLimiter(MIN_WRITE_INTERVAL_MS);

  try {
    const campaignCopy = await withMetaRetry(() =>
      metaApiCall<CopyResponse>({
        domain: "FACEBOOK",
        method: "POST",
        path: `${campaignId}/copies`,
        params: "",
        body: new URLSearchParams({
          status_option: STATUS_OPTION,
          rename_options: NO_RENAME,
        }),
        accessToken,
      }),
    );

    const newCampaignId = campaignCopy.copied_campaign_id;
    if (!newCampaignId) throw missingCopyIdError("da campanha");
    tracker.track("campaign", newCampaignId);

    const skippedAds: SkippedItem[] = [];
    const skippedAdsets: SkippedItem[] = [];
    const replacedInterests: ReplacedInterestsItem[] = [];
    const repairedCreatives: RepairedCreativeItem[] = [];
    const rebuiltAdsets: RebuiltAdsetItem[] = [];
    let copiedAdsetCount = 0;

    for (const sourceAdset of sourceAdsets) {
      const {
        id: copiedAdsetId,
        replacedInterests: adsetReplacements,
        rebuilt,
        scheduleShifted,
      } = await copyOrRebuildAdsetInto({
        accountId: act,
        sourceAdsetId: sourceAdset.id,
        targetCampaignId: newCampaignId,
        accessToken,
        isCBO,
        campaignLifetime,
        prefetchedSource: adsetsById.get(sourceAdset.id),
      });
      tracker.track("adset", copiedAdsetId);
      if (rebuilt) {
        rebuiltAdsets.push({
          sourceAdsetId: sourceAdset.id,
          sourceAdsetName: sourceAdset.name,
          scheduleShifted,
        });
      }
      if (adsetReplacements.length > 0) {
        replacedInterests.push({
          sourceAdsetId: sourceAdset.id,
          sourceAdsetName: sourceAdset.name,
          replacements: adsetReplacements,
        });
      }

      const sourceAds =
        sourceAdset.ads?.data ??
        (await listAdsetAds(sourceAdset.id, accessToken));
      const {
        copiedAds,
        skippedAds: skipped,
        repairedCreatives: repaired,
      } = await copyAdsIntoAdset(
        sourceAds,
        copiedAdsetId,
        accessToken,
        tracker,
        limiter,
        creatives,
        boostIneligibleMedia,
        isSales,
        fallbackPromotionUrl,
      );
      skippedAds.push(...skipped);
      repairedCreatives.push(...repaired);

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
      copiedAdsetCount += 1;
    }

    if (copiedAdsetCount === 0) {
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

    // Only the campaign is renamed (deduped "- Cópia"). Child ad sets and ads keep
    // their source names — dropping the per-child rename pass removes N+M write
    // calls (≈ half the writes on a large tree), the single biggest rate-limit
    // saving here. Meta's `/copies` already preserves source names.
    await renameObject(newCampaignId, newName, accessToken);

    return {
      id: newCampaignId,
      name: newName,
      sourceName,
      ...(skippedAds.length ? { skippedAds } : {}),
      ...(skippedAdsets.length ? { skippedAdsets } : {}),
      ...(replacedInterests.length ? { replacedInterests } : {}),
      ...(repairedCreatives.length ? { repairedCreatives } : {}),
      ...(rebuiltAdsets.length ? { rebuiltAdsets } : {}),
    };
  } catch (err) {
    return rollbackAndThrow(tracker, accessToken, err);
  }
}

/**
 * Duplicates an ad set (with its ads) WITHIN THE SAME campaign. Tries one async
 * deep-copy job first when the ads fit Meta's async cap, otherwise — or on any
 * async failure — copies the ad set and each ad individually so Meta's sync-copy
 * limit is never hit. Only the ad set is renamed; its ads keep their source names.
 * The entity path rolls back the new ad set and ads if any child copy fails.
 */
export async function duplicateAdSet(args: {
  accountId: string;
  adsetId: string;
  accessToken: string;
  /** Website URL injected into ad copies whose creative lacks one (sales). */
  fallbackPromotionUrl?: string;
}): Promise<DuplicateResult> {
  const { accountId, adsetId, accessToken, fallbackPromotionUrl } = args;
  const act = formatAccountId(accountId);

  // Read-only prep, OUTSIDE the rollback scope.
  // One read of the source ad set — campaign_id (to find the parent) plus the rebuild
  // fields, reused by copyOrRebuildAdsetInto (no second per-ad-set GET).
  const source = await metaApiCall<AdsetFull & { campaign_id?: string }>({
    domain: "FACEBOOK",
    method: "GET",
    path: adsetId,
    params: `fields=campaign_id,${ADSET_REBUILD_FIELDS}`,
    accessToken,
  });

  if (!source.campaign_id) throw missingCopyIdError("da campanha de origem");
  const campaignId = source.campaign_id;

  const [siblings, sourceAds, campaign] = await Promise.all([
    metaApiCall<{ data?: NamedNode[] }>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${campaignId}/adsets`,
      params: "fields=name&limit=500",
      accessToken,
    }),
    metaApiCall<{ data?: Array<NamedNode & { creative?: GraphCreativeShape }> }>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${adsetId}/ads`,
      params: `fields=id,name,creative{${CREATIVE_PREFETCH_FIELDS}}&limit=200`,
      accessToken,
    }).then((r) => r.data ?? []),
    metaApiCall<{
      objective?: string;
      smart_promotion_type?: string;
      daily_budget?: string;
      lifetime_budget?: string;
    }>({
      domain: "FACEBOOK",
      method: "GET",
      path: campaignId,
      params: "fields=objective,smart_promotion_type,daily_budget,lifetime_budget",
      accessToken,
    }),
  ]);

  // A parent ASC/AAC campaign means even an ad-set copy under it is refused by
  // Meta v25 — fail clearly before spending any call.
  assertCopyableCampaignType(campaign.smart_promotion_type);

  const isCBO =
    hasPositiveMinorUnits(campaign.daily_budget) ||
    hasPositiveMinorUnits(campaign.lifetime_budget);
  const campaignLifetime = hasPositiveMinorUnits(campaign.lifetime_budget);
  const isSales = campaign.objective === "OUTCOME_SALES";

  // Creatives came with the ads read above (one request), so ad copies can pre-empt
  // creative repairs on the first attempt.
  const creatives = new Map<string, GraphCreativeShape>();
  for (const ad of sourceAds) {
    if (ad.creative) creatives.set(ad.id, ad.creative);
  }
  // Boost-eligibility verdict for the IG-post boosts (one `?ids=` read; no call when
  // there are none) so copyrighted-music reels are pre-skipped without spending a 400
  // each on `/copies` (subcode 2875030) against the app's Meta error budget.
  const boostIneligibleMedia = await fetchBoostIneligibleMedia(
    collectSourceMediaIds(creatives),
    accessToken,
  );
  // Pre-flight: ask for the destination URL now (before creating anything) when a
  // sales ad set has a URL-less creative and none was supplied — avoids the first
  // copy 400 (2446383) that would otherwise surface the same prompt. Creatives we'll
  // pre-skip (boost-ineligible) are excluded so they don't force a URL prompt.
  if (
    isSales &&
    !fallbackPromotionUrl &&
    someCreativeNeedsUrl(creatives, boostIneligibleMedia)
  ) {
    throw promotionUrlRequiredError();
  }

  const sourceName = source.name ?? "Conjunto";
  const newName = resolveCopyName(
    sourceName,
    (siblings.data ?? []).map((a) => a.name ?? ""),
  );

  // Fast path: async deep-copy the ad set (its ads are the children) when they fit
  // the cap; on anything unexpected, fall through to entity-by-entity.
  if (
    ASYNC_DEEPCOPY_ENABLED &&
    sourceAds.length > 0 &&
    sourceAds.length <= ASYNC_DEEPCOPY_MAX_CHILDREN
  ) {
    const outcome = await tryAsyncDeepCopy({
      accountId: act,
      sourceId: adsetId,
      copiedIdField: "copied_adset_id",
      accessToken,
    });
    if (outcome.status === "done") {
      try {
        await renameObject(outcome.copiedId, newName, accessToken);
      } catch {
        /* keep the successful copy even if the rename is throttled out */
      }
      return { id: outcome.copiedId, name: newName, sourceName };
    }
    if (outcome.status === "in_progress") {
      throw new DuplicateInProgressError(outcome.requestSetId);
    }
  }

  const tracker = new CreatedObjectsTracker();
  const limiter = createWriteLimiter(MIN_WRITE_INTERVAL_MS);

  try {
    const {
      id: newAdsetId,
      replacedInterests: adsetReplacements,
      rebuilt,
      scheduleShifted,
    } = await copyOrRebuildAdsetInto({
      accountId,
      sourceAdsetId: adsetId,
      targetCampaignId: campaignId,
      accessToken,
      isCBO,
      campaignLifetime,
      prefetchedSource: source,
    });
    tracker.track("adset", newAdsetId);

    const { copiedAds, skippedAds, repairedCreatives } = await copyAdsIntoAdset(
      sourceAds,
      newAdsetId,
      accessToken,
      tracker,
      limiter,
      creatives,
      boostIneligibleMedia,
      isSales,
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

    // Only the ad set is renamed; its ads keep source names (drops the per-ad
    // rename pass — fewer writes, lower rate-limit pressure).
    await renameObject(newAdsetId, newName, accessToken);

    return {
      id: newAdsetId,
      name: newName,
      sourceName,
      ...(skippedAds.length ? { skippedAds } : {}),
      ...(adsetReplacements.length
        ? {
            replacedInterests: [
              {
                sourceAdsetId: adsetId,
                sourceAdsetName: sourceName,
                replacements: adsetReplacements,
              },
            ],
          }
        : {}),
      ...(repairedCreatives.length ? { repairedCreatives } : {}),
      ...(rebuilt
        ? {
            rebuiltAdsets: [
              {
                sourceAdsetId: adsetId,
                sourceAdsetName: sourceName,
                scheduleShifted,
              },
            ],
          }
        : {}),
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
    // One read of the ad node — name, adset_id and the creative together, so the
    // creative pre-fetch costs no extra call.
    const source = await metaApiCall<{
      name?: string;
      adset_id?: string;
      creative?: GraphCreativeShape;
    }>({
      domain: "FACEBOOK",
      method: "GET",
      path: adId,
      params: `fields=name,adset_id,creative{${CREATIVE_PREFETCH_FIELDS}}`,
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

    // The creative came with the source read above, so a deprecated
    // standard-enhancements bundle is stripped on the first copy (no 400). URL repair
    // stays reactive here (the objective isn't read on this path).
    const { copiedAdId: newAdId, repairs } = await copyAdWithRepair(
      adId,
      source.adset_id,
      accessToken,
      {
        fallbackPromotionUrl,
        prefetchedCreative: source.creative ?? null,
        isSales: false,
      },
    );
    if (!newAdId) throw missingCopyIdError("do anúncio");
    tracker.track("ad", newAdId);

    await renameObject(newAdId, newName, accessToken);

    return {
      id: newAdId,
      name: newName,
      sourceName: source.name ?? "Anúncio",
      ...(repairs.length
        ? {
            repairedCreatives: [
              { sourceAdId: adId, sourceAdName: source.name, repairs },
            ],
          }
        : {}),
    };
  } catch (err) {
    return rollbackAndThrow(tracker, accessToken, err);
  }
}

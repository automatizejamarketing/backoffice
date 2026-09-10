/**
 * Throttle-aware retry for Meta WRITE calls (Graph `#613` and siblings).
 *
 * A throttle is rejected BEFORE any object is created or mutated, so a retry
 * cannot double-create. Permanent rejections (param errors, dead token, …)
 * rethrow immediately.
 *
 * MIRRORED FILE — `automatize-frontend` and `backoffice` must hold BYTE-IDENTICAL
 * copies. After editing: `cd automatize-frontend && bun run sync:meta`.
 */

import { metaApiCall, type MetaApiCallParams } from "@/lib/meta-business/api";
import { GraphApiError } from "@/lib/meta-business/error";

export const MAX_WRITE_RETRY_ATTEMPTS = 5;
const RETRY_BASE_MS = 800;
/** Cap a single backoff so one retry can't blow the serverless function budget. */
const RETRY_MAX_WAIT_MS = 20_000;

/**
 * Marketing-API throttle / rate-limit error codes (from Meta's Rate Limiting
 * reference). Match on the Graph `code` — NOT the mapped HTTP status and NOT
 * `reason.isTransient` (whose generic default of `true` would retry permanent
 * param errors).
 */
export const RETRYABLE_THROTTLE_CODES = new Set<number>([
  4, // application request limit reached
  17, // user request limit reached
  341, // application limit reached
  368, // temporarily blocked for policy violations
  613, // calls-per-ad-account / QPS exceeded (incl. subcode 4841018)
  80000, // BUC ads_management rate limit
  80003,
  80004,
  80014,
  1404078, // temporarily blocked
  2859015, // action temporarily blocked
]);

export type WriteRetrySleep = (ms: number) => Promise<void>;

const defaultSleep: WriteRetrySleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** True only for a genuine Meta throttle. Synthetic local errors return false. */
export function isRetryableMetaThrottle(err: unknown): boolean {
  if (!(err instanceof GraphApiError)) return false;
  const code = err.errorReturn.data?.code;
  return code != null && RETRYABLE_THROTTLE_CODES.has(code);
}

/** Backoff for attempt N, honoring Meta's suggested wait but capped to the budget. */
export function retryWaitMs(err: unknown, attempt: number): number {
  const rl = err instanceof GraphApiError ? err.errorReturn.rateLimit : undefined;
  const serverWait = Math.max(rl?.retryAfterMs ?? 0, rl?.estimatedRegainMs ?? 0);
  const backoff = RETRY_BASE_MS * 2 ** attempt;
  const jitter = Math.floor(backoff * 0.25 * Math.random());
  return Math.min(RETRY_MAX_WAIT_MS, Math.max(serverWait, backoff + jitter));
}

/**
 * Run a Meta WRITE with throttle-aware retry. On a retryable throttle we wait
 * the server-suggested time (or exponential backoff) and try again, up to
 * {@link MAX_WRITE_RETRY_ATTEMPTS}; anything else rethrows immediately.
 */
export async function withMetaRetry<T>(
  fn: () => Promise<T>,
  opts: { sleep?: WriteRetrySleep; maxAttempts?: number } = {},
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = opts.maxAttempts ?? MAX_WRITE_RETRY_ATTEMPTS;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableMetaThrottle(err) || attempt >= maxAttempts) throw err;
      await sleep(retryWaitMs(err, attempt));
      attempt += 1;
    }
  }
}

/** `metaApiCall` with throttle retry — use for POST/DELETE writes, not reads. */
export function metaWrite<T>(args: MetaApiCallParams): Promise<T> {
  return withMetaRetry(() => metaApiCall<T>(args));
}

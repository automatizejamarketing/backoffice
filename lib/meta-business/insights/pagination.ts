/**
 * Internal pagination + synchronous-size guard.
 *
 * The chat is 100% synchronous (no async report runs). Tools paginate INTERNALLY
 * up to a ceiling and expose a `truncated` flag — the Graph API cursor never
 * reaches the model (design §1 principle 5, §3 getInsights). When an estimated
 * query is too large, the tool throws {@link OversizedError} so the agent can
 * negotiate a narrower cut instead of timing out.
 */
import { OversizedError } from "./envelope";

/** Default internal pagination ceiling (design §7: ~5 pages / ~250 rows). */
export const DEFAULT_MAX_PAGES = 5;
export const DEFAULT_MAX_ROWS = 250;

/** Upper bound on estimated rows before we refuse and renegotiate. */
const OVERSIZED_ROW_ESTIMATE = 5000;

export type Page<T> = { data: T[]; after?: string };

export type PaginateOptions<T> = {
  maxPages?: number;
  maxRows?: number;
  /**
   * Keep rows WHILE this holds. The first row that fails it ends the sweep: that row and
   * everything after it are dropped, and no further page is fetched.
   *
   * ONLY VALID ON A SORTED STREAM — the name says `Sorted` because that is a precondition, not a
   * hint: a failing row must PROVE every later row fails too. The AI-creation account scan sweeps
   * spend-descending and stops at the spend floor (ADR 0022). On an unsorted stream (e.g. the
   * `findObjects` listings in ./objects.ts) this would silently drop rows that still qualify, so
   * the caller — not this helper — owns the ordering guarantee.
   */
  takeWhileSorted?: (row: T) => boolean;
};

export type PaginateResult<T> = {
  rows: T[];
  /**
   * True when rows the caller ASKED FOR were left unread — the ceiling (`maxRows`/`maxPages`) cut
   * the sweep short while a cursor was still pending. The agent should offer to refine.
   *
   * An early stop via `takeWhileSorted` is NOT truncation: the sweep ended because nothing beyond
   * that point could qualify, so the caller has everything it asked for even though more rows
   * exist on Meta's side.
   */
  truncated: boolean;
};

/**
 * Follow Graph cursor pagination up to the ceiling. `fetchPage(after)` returns a
 * page of rows plus the next `after` cursor (undefined when no more pages).
 */
export async function paginate<T>(
  fetchPage: (after?: string) => Promise<Page<T>>,
  options: PaginateOptions<T> = {},
): Promise<PaginateResult<T>> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const { takeWhileSorted } = options;

  const rows: T[] = [];
  let after: string | undefined;

  /** Cut to the ceiling. `moreOnMeta` = a cursor was still pending when we stopped. */
  const capped = (moreOnMeta: boolean): PaginateResult<T> => ({
    rows: rows.slice(0, maxRows),
    truncated: rows.length > maxRows || moreOnMeta,
  });

  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(after);

    // Sorted-stream early stop: the first failing row proves the rest of the stream fails too, so
    // the sweep ends here and the remaining pages are never paid for. NOT truncation — everything
    // the caller asked for was read (see PaginateResult.truncated).
    if (takeWhileSorted) {
      const stopAt = result.data.findIndex((row) => !takeWhileSorted(row));
      if (stopAt !== -1) {
        rows.push(...result.data.slice(0, stopAt));
        return capped(false);
      }
    }

    rows.push(...result.data);

    if (rows.length >= maxRows) return capped(Boolean(result.after));

    after = result.after;
    if (!after) return { rows, truncated: false };
  }

  // Hit the page ceiling with a cursor still pending → more data exists.
  return { rows, truncated: Boolean(after) };
}

/**
 * Rough pre-flight estimate of result rows = objects × periods × breakdown
 * cardinality. Throws {@link OversizedError} when it clearly exceeds the
 * synchronous ceiling so the agent renegotiates (design §3, §7).
 *
 * `breakdownCount` is the number of active breakdowns (each multiplies cardinality
 * by an assumed average bucket count).
 */
export function assertWithinSyncBudget(params: {
  objectCount: number;
  periods: number;
  breakdownCount: number;
}): void {
  const { objectCount, periods, breakdownCount } = params;
  // Assume ~15 buckets per breakdown dimension on average (age/region/etc.).
  const breakdownFactor = Math.pow(15, Math.max(0, breakdownCount));
  const estimate =
    Math.max(1, objectCount) * Math.max(1, periods) * breakdownFactor;

  if (estimate > OVERSIZED_ROW_ESTIMATE) {
    throw new OversizedError(
      `Estimativa de ~${Math.round(estimate)} linhas excede o limite síncrono.`,
    );
  }
}

/**
 * Who the playbook cron should evaluate next.
 *
 * The daily job used to `slice(0, 25)` of Meta-connected users ordered by
 * last token refresh. Expired accounts with a live app sat at the front
 * forever; paying clients never entered the batch.
 *
 * Ranking (SQL mirrors this):
 * 1. Nobody with a *successful* playbook snapshot today (SP).
 * 2. Never attempted today, before same-day Graph/token failures (retry last).
 * 3. Never succeeded at all, then oldest last success (fair rotation).
 * 4. Stable `userId` tie-break.
 */

export type PlaybookClaimRow = {
  userId: string;
  /** Last *successful* playbook evaluation (error snapshots ignored). */
  lastSuccessAt: Date | null;
  /** Any playbook snapshot (success or error) already captured today. */
  attemptedToday: boolean;
};

export function comparePlaybookClaimRows(
  a: PlaybookClaimRow,
  b: PlaybookClaimRow,
): number {
  if (a.attemptedToday !== b.attemptedToday) {
    return a.attemptedToday ? 1 : -1;
  }
  if ((a.lastSuccessAt === null) !== (b.lastSuccessAt === null)) {
    return a.lastSuccessAt === null ? -1 : 1;
  }
  if (a.lastSuccessAt && b.lastSuccessAt) {
    const delta = a.lastSuccessAt.getTime() - b.lastSuccessAt.getTime();
    if (delta !== 0) return delta;
  }
  return a.userId.localeCompare(b.userId);
}

export function rankPlaybookClaimQueue(
  rows: PlaybookClaimRow[],
  limit: number,
): PlaybookClaimRow[] {
  return [...rows].sort(comparePlaybookClaimRows).slice(0, Math.max(0, limit));
}

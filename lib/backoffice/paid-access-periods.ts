/**
 * Days a lapsed customer has to renew before it counts as leaving. Pix is
 * renewed by hand, so paying a day or two late is not churn.
 */
export const PAID_ACCESS_GRACE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One row of user_expiration_history. */
export type ExpirationChange = {
  changedAt: Date;
  previousExpirationDate: Date | null;
  expirationDate: Date | null;
};

/** A stretch of paid access: from startedAt until endedAt (exclusive). */
export type PaidAccessPeriod = {
  startedAt: Date;
  endedAt: Date;
};

/**
 * Rebuilds when a customer had paid access from the expiration history.
 *
 * Between two changes the expiration in effect is the one the earlier change
 * set; access lasts while that expiration is ahead. Before the first recorded
 * change (the history only exists since the trigger was created) the
 * expiration in effect is the one that change replaced — the current one when
 * nothing changed — which is how the dashboard read access before the history.
 *
 * Paid access starts at the first approved payment, so a trial before it is
 * not a period. Periods closer than the grace are one period.
 */
export function buildPaidAccessPeriods(
  input: {
    firstPaidAt: Date;
    currentExpirationDate: Date | null;
    changes: ExpirationChange[];
  },
  graceDays: number = PAID_ACCESS_GRACE_DAYS,
): PaidAccessPeriod[] {
  const changes = [...input.changes].sort(
    (left, right) => left.changedAt.getTime() - right.changedAt.getTime(),
  );
  const segments: { from: number; to: number; expiration: Date | null }[] = [
    {
      from: Number.NEGATIVE_INFINITY,
      to: changes[0]?.changedAt.getTime() ?? Number.POSITIVE_INFINITY,
      expiration: changes[0]
        ? changes[0].previousExpirationDate
        : input.currentExpirationDate,
    },
    ...changes.map((change, index) => ({
      from: change.changedAt.getTime(),
      to: changes[index + 1]?.changedAt.getTime() ?? Number.POSITIVE_INFINITY,
      expiration: change.expirationDate,
    })),
  ];

  const firstPaidAt = input.firstPaidAt.getTime();
  const graceMs = graceDays * DAY_MS;
  const periods: { start: number; end: number }[] = [];

  for (const segment of segments) {
    if (!segment.expiration) continue;
    const start = Math.max(segment.from, firstPaidAt);
    const end = Math.min(segment.expiration.getTime(), segment.to);
    if (end <= start) continue;

    const last = periods.at(-1);
    if (last && start - last.end <= graceMs) {
      last.end = Math.max(last.end, end);
    } else {
      periods.push({ start, end });
    }
  }

  return periods.map((period) => ({
    startedAt: new Date(period.start),
    endedAt: new Date(period.end),
  }));
}

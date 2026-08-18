/**
 * Currency / number helpers for the insights layer.
 *
 * CRITICAL distinction (Marketing API v25.0):
 * - Insights monetary fields (`spend`, `cpc`, `cpm`, `cpp`, action values) are
 *   returned in the account's currency as MAJOR-unit decimals (e.g. "12.34").
 *   → use {@link toNumber} (do NOT divide by 100).
 * - Budgets (`daily_budget`/`lifetime_budget`) and account `amount_spent`/
 *   `spend_cap`/`balance` are returned in MINOR units (cents) as strings.
 *   → use {@link minorToMajor} (divide by 100).
 *
 * Keeping these apart prevents "right-looking but wrong" answers (design §8).
 */

/** Parse a numeric string to a number, or null when absent/invalid. */
export function toNumber(value?: string | number | null): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Round to 2 decimals (for money/ratios). */
export function round2(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Convert a MINOR-unit (cents) string to a MAJOR-unit number.
 * Use for budgets and account amount_spent/spend_cap/balance — never for insights.
 */
export function minorToMajor(value?: string | number | null): number | null {
  if (value == null) return null;
  const cents =
    typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(cents)) return null;
  return round2(cents / 100);
}

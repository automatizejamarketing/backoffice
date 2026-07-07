/**
 * Shared, dependency-free ad-account id matching (ADR 0013).
 *
 * The Graph API returns `account_id` as a bare numeric string, while the app
 * passes account ids both bare and `act_`-prefixed. One comparison used by the
 * mutation-ownership guard (`marketing/update/ownership`) AND the read-ownership
 * guard (`insights/envelope`) so the two can never drift.
 */
export function stripActPrefix(id: string): string {
  return id.replace(/^act_/, "");
}

/** True when both ids resolve to the same ad account (prefix-insensitive). */
export function isSameAccount(a: string, b: string): boolean {
  return stripActPrefix(a) === stripActPrefix(b);
}

/**
 * Prepaid-aware "how much money does this ad account have" resolver — the SINGLE
 * source of truth shared by the marketing dashboard's "Facebook conectado" card,
 * the Mat chat's account-context tool, and the low-balance alert.
 *
 * The rule (see docs/CONTEXT.md "Saldo disponível vs Fatura em aberto"):
 * - PREPAID (`is_prepay_account === true`): the spendable "Saldo disponível" is
 *   Meta's own formatted string `funding_source_details.display_string`
 *   (e.g. "R$ 15,63" or "Saldo disponível (R$ 15,63 BRL)"). Use it VERBATIM —
 *   do NOT divide, do NOT read `balance` (for prepaid, `balance` is a residual/
 *   pending figure, NOT the spendable funds — this is exactly the R$ 2,45-vs-
 *   R$ 15,63 bug the chat used to report).
 * - POSTPAID (`is_prepay_account` falsy): there is NO prepaid "saldo". `balance`
 *   is the amount OWED (a running tab / "Fatura em aberto"), in MINOR units
 *   (centavos) → divide by 100. It is a debt, never available funds.
 */

export type AdAccountFundingInput = {
  is_prepay_account?: boolean | null;
  funding_source_details?: { display_string?: string | null } | null;
  /** Meta `balance`, MINOR units (centavos) as a string or number. */
  balance?: string | number | null;
};

export type AdAccountMoney =
  /** Prepaid spendable funds — a Meta-formatted string, presented verbatim. */
  | { kind: "available"; display: string }
  /** Postpaid amount owed ("Fatura em aberto"), in MAJOR units (e.g. reais). */
  | { kind: "owed"; amountMajor: number }
  | null;

/**
 * Resolve the meaningful money figure for a Meta ad account, prepaid-aware.
 * Returns `null` when the figure is absent (so a debt is never shown as funds and
 * a missing value is simply hidden).
 */
export function resolveAdAccountMoney(a: AdAccountFundingInput): AdAccountMoney {
  if (a.is_prepay_account) {
    const display = a.funding_source_details?.display_string?.trim();
    return display ? { kind: "available", display } : null;
  }
  if (a.balance == null || a.balance === "") return null;
  const major = Number(a.balance) / 100;
  if (!Number.isFinite(major)) return null;
  return { kind: "owed", amountMajor: major };
}

/**
 * Did Meta withhold the money fields because the caller's ad-account task is too
 * low, rather than because the account simply has no figure to show?
 *
 * Meta gates these by task (Marketing API AdAccount reference):
 * `funding_source_details` requires MANAGE, `is_prepay_account` requires MANAGE
 * or ADVERTISE, `balance` requires neither. A Business Integration System User
 * assigned only ANALYZE therefore reads the account fine but gets no saldo — a
 * silent blank the user cannot distinguish from "R$ 0,00". Callers use this to
 * say "grant admin (MANAGE) access to the integration" instead of showing nothing.
 *
 * Only meaningful when `resolveAdAccountMoney` already returned `null`.
 */
export function isAdAccountMoneyBlockedByPermission(
  a: AdAccountFundingInput,
): boolean {
  // `is_prepay_account` absent AND `balance` absent: even the ungated field did
  // not come back, so this is an access problem, not an empty account.
  if (a.is_prepay_account === undefined || a.is_prepay_account === null) {
    return a.balance == null || a.balance === "";
  }
  // Prepaid, but the MANAGE-gated string is missing — the spendable saldo exists
  // and is simply not readable at this task level.
  if (a.is_prepay_account) {
    return !a.funding_source_details?.display_string?.trim();
  }
  // Postpaid with a readable `is_prepay_account`: `balance` is ungated, so a
  // missing figure is a genuinely absent one.
  return false;
}

/**
 * Best-effort numeric amount (major units) out of a prepaid `display_string` like
 * "R$ 15,63" or "Saldo disponível (R$ 15,63 BRL)". pt-BR formatting: "." thousands
 * separator, "," decimal. Returns null when unparseable. Used only where a NUMBER
 * is required (the low-balance threshold); the chat/card present the string verbatim.
 */
export function parseDisplayAmount(
  display: string | null | undefined,
): number | null {
  if (!display) return null;
  // Grab an optional-thousands integer part followed by an optional ",dd" decimal.
  const match = display.match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/);
  if (!match) return null;
  const intPart = match[1].replace(/\./g, "");
  const decPart = (match[2] ?? "0").padEnd(2, "0").slice(0, 2);
  const n = Number.parseFloat(`${intPart}.${decPart}`);
  return Number.isFinite(n) ? n : null;
}

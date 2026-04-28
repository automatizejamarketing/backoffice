// Brazilian phone display helpers for the backoffice. Numbers are stored in
// the shared DB as digits-only (10 or 11 chars, no country code).

const DIGITS_ONLY = /\D+/g;

/**
 * Format a digits-only Brazilian phone for display:
 *   - 10 digits → `(AA) NNNN-NNNN` (landline)
 *   - 11 digits → `(AA) NNNNN-NNNN` (mobile, leading 9)
 * Partial input is masked progressively. Anything beyond 11 digits is dropped.
 */
export function formatBrazilianPhone(value: string | null | undefined): string {
  if (!value) return "";
  const d = value.replace(DIGITS_ONLY, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/**
 * Build a `wa.me` link from a digits-only Brazilian phone, prefixing the
 * country code (55). Returns `null` when the input is missing or doesn't have
 * a valid 10–11 digit body.
 */
export function whatsappLink(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = value.replace(DIGITS_ONLY, "");
  if (d.length < 10 || d.length > 11) return null;
  return `https://wa.me/55${d}`;
}

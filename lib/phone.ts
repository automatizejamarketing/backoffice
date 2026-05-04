/**
 * Helpers for Brazilian phone numbers stored in canonical digits-only form
 * (10 or 11 digits, no country code — see `users.phone` in `lib/db/schema.ts`).
 */

/**
 * Strip every non-digit character. Returns an empty string for nullish input.
 */
function digitsOnly(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D/g, "");
}

/**
 * Format a Brazilian phone number for display.
 *
 * - 11 digits (mobile): `(11) 99999-8888`
 * - 10 digits (landline): `(11) 9999-8888`
 * - Anything else: returned as-is (digits only).
 */
export function formatBrazilianPhone(
  value: string | null | undefined,
): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return digits;
}

/**
 * Build a wa.me URL for a Brazilian phone number stored without country code.
 * Returns `null` when the input does not look like a valid 10–11 digit BR number.
 */
export function getWhatsAppUrl(
  value: string | null | undefined,
): string | null {
  const digits = digitsOnly(value);
  if (digits.length !== 10 && digits.length !== 11) return null;

  return `https://wa.me/55${digits}`;
}

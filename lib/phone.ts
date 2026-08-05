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

export function normalizeBrazilianPhone(
  value: string | null | undefined,
): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return digits.length > 11 && digits.startsWith("55")
    ? digits.slice(2)
    : digits;
}

/**
 * Apply a progressive mask while a Brazilian phone number is being typed.
 * Accepts pasted values with or without the +55 country code.
 */
export function formatBrazilianPhoneInput(
  value: string | null | undefined,
): string {
  const digits = (normalizeBrazilianPhone(value) ?? "").slice(0, 11);

  if (!digits) return "";
  if (digits.length < 3) return `(${digits}`;

  const areaCode = digits.slice(0, 2);
  const phone = digits.slice(2);
  const prefixLength = digits.length === 11 ? 5 : 4;

  if (phone.length <= prefixLength) {
    return `(${areaCode}) ${phone}`;
  }

  return `(${areaCode}) ${phone.slice(0, prefixLength)}-${phone.slice(prefixLength)}`;
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

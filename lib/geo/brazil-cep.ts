/** Brazilian CEP: 8 digits, optional hyphen (00000-000). */

export function normalizeBrazilCepDigits(input: string): string {
  return input.replace(/\D/g, "").slice(0, 8);
}

/** Formats 6–8 digits as 00000-000; shorter input is returned as digits only. */
export function formatBrazilCepDisplay(digits: string): string {
  const d = normalizeBrazilCepDigits(digits);
  if (d.length <= 5) {
    return d;
  }
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** True when the string is exactly 8 digits (ignoring non-digits). */
export function isFullBrazilCep(input: string): boolean {
  return normalizeBrazilCepDigits(input).length === 8;
}

const HARD_CODED_BYPASS_EMAILS = new Set(["christian.gomesss09@gmail.com"]);

export function isBypassStripeEmail(email: string | null | undefined): boolean {
  const raw = process.env.BYPASS_STRIPE_EMAILS;
  const normalizedEmail = (email ?? "").toLowerCase().trim();
  if (!normalizedEmail) return false;

  if (HARD_CODED_BYPASS_EMAILS.has(normalizedEmail)) {
    return true;
  }

  if (!raw) return false;

  const allowed = raw
    .split(/[,\s;]+/g)
    .map((value) => value.toLowerCase().trim())
    .filter(Boolean);

  return allowed.includes(normalizedEmail);
}

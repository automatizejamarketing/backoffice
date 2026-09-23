export const DEFAULT_AUTOMATIZE_BUSINESS_ID = "397851937312613";

/** Person the client invites in Business Settings → People. The guide copies this. */
export const AUTOMATIZE_PEOPLE_EMAIL = "contato@automatizemarketing.com";

export const META_BUSINESS_PEOPLE_URL =
  "https://business.facebook.com/latest/settings/business_users";

export type PartnerAccessStatus =
  | "missing"
  | "partial"
  | "pending_admin_approval"
  | "complete"
  | "unsupported";

export function getAutomatizeBusinessIdFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.META_AUTOMATIZE_BUSINESS_ID?.trim() || DEFAULT_AUTOMATIZE_BUSINESS_ID;
}

export function buildPartnersSettingsUrl(
  clientBusinessId: string | null | undefined,
): string | null {
  if (!clientBusinessId?.trim()) return null;
  return `https://business.facebook.com/latest/settings/partners?business_id=${encodeURIComponent(clientBusinessId.trim())}`;
}

export function buildPeopleSettingsUrl(
  clientBusinessId: string | null | undefined,
): string | null {
  if (!clientBusinessId?.trim()) return null;
  return `${META_BUSINESS_PEOPLE_URL}?business_id=${encodeURIComponent(clientBusinessId.trim())}`;
}

export function isPartnerAccessPending(
  status: string | null | undefined,
): boolean {
  return (
    !status ||
    status === "missing" ||
    status === "partial" ||
    status === "pending_admin_approval"
  );
}

/** Meta's help article for Graph 100/2859024 — present in error_user_msg. */
export const META_CERTIFICATION_HELP_ID = "338925176776440";

/**
 * Backoffice AI currently surfaces only `message`, not Graph codes.
 * Match Meta's own help id / subcode so we do not guess from prose.
 */
export function looksLikeCertificationRequired(
  message: string | null | undefined,
): boolean {
  if (!message) return false;
  return (
    message.includes(META_CERTIFICATION_HELP_ID) || message.includes("2859024")
  );
}

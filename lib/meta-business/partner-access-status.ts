export const DEFAULT_AUTOMATIZE_BUSINESS_ID = "397851937312613";

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

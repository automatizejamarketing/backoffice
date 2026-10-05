import { parseInstagramAudienceRule } from "@/lib/meta-business/marketing/audiences/instagram";
import { parseWebsiteAudienceRule } from "@/lib/meta-business/marketing/audiences/website";
import type { CustomAudienceView } from "@/lib/meta-business/marketing/audiences/types";

export type AudienceCreateKind = "customer" | "instagram" | "website" | "lookalike";
export type AudienceEditKind = "customer" | "instagram" | "website" | "metadata";

export function audienceTypeLabel(audience: CustomAudienceView) {
  if (parseInstagramAudienceRule(audience.rule)) return "Instagram";
  if (audience.rule && parseWebsiteAudienceRule(audience.rule)) return "Site";
  if (audience.subtype === "LOOKALIKE") return "Semelhante";
  if (audience.subtype === "CUSTOM" || audience.capabilities.manageMembers === "available") {
    return "Lista de clientes";
  }
  return audience.subtype ?? "Público";
}

export function resolveAudienceEditKind(audience: CustomAudienceView): AudienceEditKind {
  if (parseInstagramAudienceRule(audience.rule)) return "instagram";
  if (audience.rule && parseWebsiteAudienceRule(audience.rule)) return "website";
  if (audience.capabilities.manageMembers === "available") return "customer";
  return "metadata";
}

export function audienceStatusLabel(audience: CustomAudienceView) {
  return (
    audience.deliveryStatus?.description ??
    audience.operationStatus?.description ??
    "Não informado"
  );
}

export function audienceEstimateLabel(audience: CustomAudienceView) {
  const { approximateCountLowerBound: lower, approximateCountUpperBound: upper } = audience;
  if (lower === undefined && upper === undefined) return "—";
  const format = new Intl.NumberFormat("pt-BR");
  if (lower !== undefined && upper !== undefined) return `${format.format(lower)}–${format.format(upper)}`;
  return format.format(lower ?? upper ?? 0);
}

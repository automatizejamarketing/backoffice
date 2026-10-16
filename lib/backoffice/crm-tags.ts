import { z } from "zod";
import {
  hasBackofficePermission,
  type BackofficeActor,
} from "@/lib/auth/rbac-core";

export const CRM_TAG_KEYS = [
  "source:isaac",
  "profile:dono",
  "profile:gestor",
] as const;
export type CrmTagKey = (typeof CRM_TAG_KEYS)[number];
export type CrmTag = { key: CrmTagKey; name: string; color: string };
export const DEFAULT_CRM_TAGS: CrmTag[] = [
  { key: "source:isaac", name: "Campanha Isaac", color: "#6D28D9" },
  { key: "profile:dono", name: "Dono de Food Service", color: "#047857" },
  {
    key: "profile:gestor",
    name: "Gestor de Delivery / Consultor",
    color: "#0369A1",
  },
];
export const crmTagInput = z
  .object({
    key: z.enum(CRM_TAG_KEYS),
    name: z
      .string()
      .trim()
      .min(1, "Informe o nome da tag.")
      .max(60, "Use até 60 caracteres."),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Informe uma cor hexadecimal válida.")
      .transform((v) => v.toUpperCase()),
  })
  .strict();

export function canManageCrmTags(actor: BackofficeActor): boolean {
  return (
    hasBackofficePermission(actor, "crm:manage") &&
    (actor.role === "admin" || actor.salesRole === "gestor_comercial")
  );
}

export function resolveCrmTags(
  rows: { key: string; name: string; color: string }[],
): CrmTag[] {
  return DEFAULT_CRM_TAGS.map((defaultTag) => {
    const saved = rows.find((row) => row.key === defaultTag.key);
    const parsed = crmTagInput.safeParse(saved);
    return parsed.success ? parsed.data : { ...defaultTag };
  });
}

/** Choose readable text for any manager-selected solid background. */
export function crmTagTextColor(color: string): "#FFFFFF" | "#000000" {
  const channels = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#FFFFFF";
}

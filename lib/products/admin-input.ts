import { z } from "zod";
import {
  EXPERT_PARTICIPATION_BPS_MAX,
  EXPERT_PARTICIPATION_BPS_MIN,
} from "@/lib/vindi/split";

const internalCoverUrl = z.string().refine((value) => {
  if (!value.startsWith("/api/products/assets?")) return false;
  const url = new URL(value, "https://automatize.internal");
  const key = url.searchParams.get("key");
  return (
    url.pathname === "/api/products/assets" &&
    url.searchParams.size === 1 &&
    Boolean(key?.startsWith("r2/product-covers/") && !key.includes(".."))
  );
}, "URL interna de capa inválida");

const schema = z.object({
  ownerType: z.enum(["automatize", "expert"]).default("automatize"),
  expertId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(2).max(180),
  slug: z.string().trim().optional().default(""),
  description: z.string().trim().max(5_000).optional().nullable(),
  coverUrl: z
    .union([z.string().url(), internalCoverUrl])
    .optional()
    .nullable()
    .or(z.literal("")),
  priceCentavos: z.number().int().min(0),
  hasCoproduction: z.boolean().default(false),
  coproducerType: z.enum(["automatize", "expert"]).optional().nullable(),
  coproducerExpertId: z.string().uuid().optional().nullable(),
  coproducerSharePercent: z.number().min(0).max(100).default(0),
  minimumPlanTier: z.enum(["starter", "pro", "premium"]).optional().nullable(),
  visibility: z.enum(["public", "unlisted"]).default("unlisted"),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  salesEnabled: z.boolean().default(true),
  termsVersion: z.string().trim().min(1).max(40).default("v1"),
  expertParticipationBps: z
    .number()
    .int()
    .min(EXPERT_PARTICIPATION_BPS_MIN)
    .max(EXPERT_PARTICIPATION_BPS_MAX)
    .optional()
    .nullable(),
});

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseProductAdminInput(input: unknown) {
  const parsed = schema.parse(input);
  const slug = slugify(parsed.slug || parsed.title);
  if (!slug) throw new Error("slug is required");
  if (parsed.ownerType === "expert" && !parsed.expertId) {
    throw new Error("expert is required");
  }
  const hasCoproduction =
    parsed.ownerType === "expert" && parsed.hasCoproduction;
  if (hasCoproduction && !parsed.coproducerType) {
    throw new Error("coprodutor é obrigatório");
  }
  if (hasCoproduction && parsed.coproducerSharePercent <= 0) {
    throw new Error("participação do coprodutor deve ser maior que zero");
  }
  if (
    hasCoproduction &&
    parsed.coproducerType === "expert" &&
    !parsed.coproducerExpertId
  ) {
    throw new Error("expert coprodutor é obrigatório");
  }
  if (
    hasCoproduction &&
    parsed.coproducerType === "expert" &&
    parsed.coproducerExpertId === parsed.expertId
  ) {
    throw new Error("o coprodutor deve ser diferente do proprietário");
  }
  const coproducerShareBasisPoints = hasCoproduction
    ? Math.round(parsed.coproducerSharePercent * 100)
    : 0;

  return {
    ownerType: parsed.ownerType,
    expertId: parsed.ownerType === "expert" ? parsed.expertId! : null,
    title: parsed.title,
    slug,
    description: parsed.description || null,
    coverUrl: parsed.coverUrl || null,
    priceCentavos: parsed.priceCentavos,
    ownerExpertShareBasisPoints:
      parsed.ownerType === "expert" ? 10_000 - coproducerShareBasisPoints : 0,
    coproducerType: hasCoproduction ? parsed.coproducerType! : null,
    coproducerExpertId:
      hasCoproduction && parsed.coproducerType === "expert"
        ? parsed.coproducerExpertId!
        : null,
    coproducerShareBasisPoints,
    minimumPlanTier: parsed.minimumPlanTier ?? null,
    visibility: parsed.visibility,
    status: parsed.status,
    salesEnabled: parsed.salesEnabled,
    termsVersion: parsed.termsVersion,
    expertParticipationBps:
      parsed.ownerType === "automatize"
        ? 0
        : (parsed.expertParticipationBps ?? null),
  };
}

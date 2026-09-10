import { z } from "zod";
import {
  MAX_PLATFORM_PARTICIPATION_BPS,
  platformParticipationPercentToBps,
} from "./commercial-eligibility";
import { validateCoproducerSelection } from "./coproducer-policy";

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
  /** Percentage input is the operator-facing form of the new agreement. */
  expertParticipationPercent: z.number().finite().optional().nullable(),
  /** Bps is accepted for API callers and tests that already use the DB unit. */
  expertParticipationBps: z
    .number()
    .int()
    .min(0)
    .max(MAX_PLATFORM_PARTICIPATION_BPS)
    .optional()
    .nullable(),
  hasCoproduction: z.boolean().default(false),
  coproducerType: z.enum(["automatize", "expert"]).optional().nullable(),
  coproducerExpertId: z.string().uuid().optional().nullable(),
  coproducerSharePercent: z.number().min(0).max(100).default(0),
  minimumPlanTier: z.enum(["starter", "pro", "premium"]).optional().nullable(),
  visibility: z.enum(["public", "unlisted"]).default("unlisted"),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  salesEnabled: z.boolean().default(true),
  termsVersion: z.string().trim().min(1).max(40).default("v1"),
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
  const coproducerValidation = validateCoproducerSelection({
    hasCoproduction,
    coproducerType: parsed.coproducerType,
  });
  if (!coproducerValidation.ok) {
    throw new Error(coproducerValidation.message);
  }
  if (hasCoproduction && !parsed.coproducerType) {
    throw new Error("coprodutor é obrigatório");
  }
  if (hasCoproduction && parsed.coproducerSharePercent <= 0) {
    throw new Error("participação do coprodutor deve ser maior que zero");
  }
  const hasNewParticipationField =
    parsed.expertParticipationPercent !== undefined ||
    parsed.expertParticipationBps !== undefined;
  let expertParticipationBps: number | null = null;
  if (hasNewParticipationField && parsed.ownerType === "expert") {
    const fromPercent =
      parsed.expertParticipationPercent === null ||
      parsed.expertParticipationPercent === undefined
        ? null
        : platformParticipationPercentToBps(
            parsed.expertParticipationPercent,
          );
    const fromBps = parsed.expertParticipationBps ?? null;
    if (fromPercent !== null && fromBps !== null && fromPercent !== fromBps) {
      throw new Error("A participação informada não é consistente.");
    }
    expertParticipationBps = fromBps ?? fromPercent;
  }
  if (
    parsed.ownerType === "expert" &&
    parsed.status === "published" &&
    parsed.salesEnabled &&
    expertParticipationBps === null
  ) {
    throw new Error(
      "Defina explicitamente a participação do Automatize entre 0% e 99,99% antes de publicar e habilitar as vendas.",
    );
  }
  const coproducerShareBasisPoints = hasCoproduction
    ? Math.round(parsed.coproducerSharePercent * 100)
    : 0;

  const usesNewParticipation =
    parsed.ownerType === "expert" && hasNewParticipationField;
  const effectiveCoproducerShareBasisPoints = usesNewParticipation
    ? expertParticipationBps ?? 0
    : coproducerShareBasisPoints;

  const participationValues =
    parsed.ownerType === "expert" && hasNewParticipationField
      ? { expertParticipationBps }
      : {};

  return {
    ownerType: parsed.ownerType,
    expertId: parsed.ownerType === "expert" ? parsed.expertId! : null,
    title: parsed.title,
    slug,
    description: parsed.description || null,
    coverUrl: parsed.coverUrl || null,
    priceCentavos: parsed.priceCentavos,
    ...participationValues,
    ownerExpertShareBasisPoints:
      parsed.ownerType === "expert"
        ? 10_000 - effectiveCoproducerShareBasisPoints
        : 0,
    coproducerType:
      usesNewParticipation
        ? effectiveCoproducerShareBasisPoints > 0
          ? "automatize"
          : null
        : hasCoproduction
          ? parsed.coproducerType!
          : null,
    coproducerExpertId: null,
    coproducerShareBasisPoints: effectiveCoproducerShareBasisPoints,
    minimumPlanTier: parsed.minimumPlanTier ?? null,
    visibility: parsed.visibility,
    status: parsed.status,
    salesEnabled: parsed.salesEnabled,
    termsVersion: parsed.termsVersion,
  };
}

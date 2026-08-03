import { z } from "zod";

const schema = z.object({
  ownerType: z.enum(["automatize", "expert"]).default("automatize"),
  expertId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(2).max(180),
  slug: z.string().trim().optional().default(""),
  description: z.string().trim().max(5_000).optional().nullable(),
  coverUrl: z.string().url().optional().nullable().or(z.literal("")),
  priceCentavos: z.number().int().min(0),
  expertSharePercent: z.number().min(0).max(100).default(0),
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

  return {
    ownerType: parsed.ownerType,
    expertId: parsed.ownerType === "expert" ? parsed.expertId! : null,
    title: parsed.title,
    slug,
    description: parsed.description || null,
    coverUrl: parsed.coverUrl || null,
    priceCentavos: parsed.priceCentavos,
    expertShareBasisPoints:
      parsed.ownerType === "expert"
        ? Math.round(parsed.expertSharePercent * 100)
        : 0,
    minimumPlanTier: parsed.minimumPlanTier ?? null,
    visibility: parsed.visibility,
    status: parsed.status,
    salesEnabled: parsed.salesEnabled,
    termsVersion: parsed.termsVersion,
  };
}

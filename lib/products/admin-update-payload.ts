export type ProductAdminUpdateSource = {
  ownerType: "automatize" | "expert";
  expertId: string | null;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  priceCentavos: number;
  coproducerType: "automatize" | "expert" | null;
  coproducerExpertId: string | null;
  coproducerShareBasisPoints: number;
  minimumPlanTier: "starter" | "pro" | "premium" | null;
  visibility: "public" | "unlisted";
  status: "draft" | "published" | "archived";
  salesEnabled: boolean;
  termsVersion: string;
  expertParticipationBps: number | null;
};

type ProductAdminUpdateOverrides = Partial<
  Pick<ProductAdminUpdateSource, "status" | "salesEnabled">
>;

export function buildProductAdminUpdatePayload(
  product: ProductAdminUpdateSource,
  overrides: ProductAdminUpdateOverrides = {},
) {
  return {
    ownerType: product.ownerType,
    expertId: product.expertId,
    title: product.title,
    slug: product.slug,
    description: product.description,
    coverUrl: product.coverUrl,
    priceCentavos: product.priceCentavos,
    hasCoproduction: product.coproducerType !== null,
    coproducerType: product.coproducerType,
    coproducerExpertId: product.coproducerExpertId,
    coproducerSharePercent: product.coproducerShareBasisPoints / 100,
    minimumPlanTier: product.minimumPlanTier,
    visibility: product.visibility,
    status: product.status,
    salesEnabled: product.salesEnabled,
    termsVersion: product.termsVersion,
    expertParticipationBps: product.expertParticipationBps,
    ...overrides,
  };
}

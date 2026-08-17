import { describe, expect, test } from "bun:test";
import { buildProductAdminUpdatePayload } from "./admin-update-payload";

describe("buildProductAdminUpdatePayload", () => {
  test("enables acquisition while preserving the remaining product fields", () => {
    const product = {
      ownerType: "expert" as const,
      expertId: "11111111-1111-4111-8111-111111111111",
      title: "Produto",
      slug: "produto",
      description: "Descrição",
      coverUrl: "https://example.com/cover.webp",
      priceCentavos: 12_900,
      coproducerType: "automatize" as const,
      coproducerExpertId: null,
      coproducerShareBasisPoints: 2_500,
      minimumPlanTier: "pro" as const,
      visibility: "public" as const,
      status: "published" as const,
      salesEnabled: false,
      termsVersion: "v2",
      expertParticipationBps: 8_000,
    };

    expect(
      buildProductAdminUpdatePayload(product, { salesEnabled: true }),
    ).toEqual({
      ownerType: "expert",
      expertId: "11111111-1111-4111-8111-111111111111",
      title: "Produto",
      slug: "produto",
      description: "Descrição",
      coverUrl: "https://example.com/cover.webp",
      priceCentavos: 12_900,
      hasCoproduction: true,
      coproducerType: "automatize",
      coproducerExpertId: null,
      coproducerSharePercent: 25,
      minimumPlanTier: "pro",
      visibility: "public",
      status: "published",
      salesEnabled: true,
      termsVersion: "v2",
      expertParticipationBps: 8_000,
    });
  });
});

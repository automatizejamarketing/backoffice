import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProductAdminInput } from "./admin-input";

describe("product admin input", () => {
  it("normalizes an Automatize product and forces zero expert share", () => {
    assert.deepEqual(
      parseProductAdminInput({
        ownerType: "automatize",
        title: "  Oferta que vende ",
        slug: " Oferta que vende ",
        priceCentavos: 12900,
        hasCoproduction: false,
        visibility: "public",
        status: "published",
        salesEnabled: true,
        minimumPlanTier: "pro",
      }),
      {
        ownerType: "automatize",
        title: "Oferta que vende",
        slug: "oferta-que-vende",
        expertId: null,
        ownerExpertShareBasisPoints: 0,
        coproducerType: null,
        coproducerExpertId: null,
        coproducerShareBasisPoints: 0,
        priceCentavos: 12900,
        description: null,
        coverUrl: null,
        minimumPlanTier: "pro",
        visibility: "public",
        status: "published",
        salesEnabled: true,
        termsVersion: "v1",
      },
    );
  });

  it("ignores a leftover expert participation field on Automatize products", () => {
    const parsed = parseProductAdminInput({
      ownerType: "automatize",
      title: "Oferta da casa",
      priceCentavos: 10_000,
      expertParticipationBps: 8_000,
    });

    assert.equal("expertParticipationBps" in parsed, false);
    assert.equal(parsed.ownerExpertShareBasisPoints, 0);
    assert.equal(parsed.coproducerShareBasisPoints, 0);
  });

  it("ignores a leftover expert participation field on Expert products", () => {
    const parsed = parseProductAdminInput({
      ownerType: "expert",
      expertId: "11111111-1111-4111-8111-111111111111",
      title: "Produto",
      priceCentavos: 10_000,
      hasCoproduction: false,
      expertParticipationBps: 8_000,
    });

    assert.equal("expertParticipationBps" in parsed, false);
    assert.equal(parsed.ownerExpertShareBasisPoints, 10_000);
    assert.equal(parsed.coproducerType, null);
    assert.equal(parsed.coproducerShareBasisPoints, 0);
  });

  it("requires an expert for expert products", () => {
    assert.throws(() =>
      parseProductAdminInput({
        ownerType: "expert",
        title: "Produto",
        slug: "produto",
        priceCentavos: 1000,
        hasCoproduction: false,
      }), /expert/);
  });

  it("gives the owner expert 100% when coproduction is disabled", () => {
    const parsed = parseProductAdminInput({
      ownerType: "expert",
      expertId: "11111111-1111-4111-8111-111111111111",
      title: "Produto",
      priceCentavos: 1000,
      hasCoproduction: false,
    });

    assert.equal(parsed.ownerExpertShareBasisPoints, 10_000);
    assert.equal(parsed.coproducerType, null);
    assert.equal(parsed.coproducerExpertId, null);
    assert.equal(parsed.coproducerShareBasisPoints, 0);
    assert.equal("expertParticipationBps" in parsed, false);
  });

  it("supports Automatize as the optional coproducer", () => {
    const parsed = parseProductAdminInput({
      ownerType: "expert",
      expertId: "11111111-1111-4111-8111-111111111111",
      title: "Produto",
      priceCentavos: 1000,
      hasCoproduction: true,
      coproducerType: "automatize",
      coproducerSharePercent: 40,
    });

    assert.equal(parsed.ownerExpertShareBasisPoints, 6_000);
    assert.equal(parsed.coproducerType, "automatize");
    assert.equal(parsed.coproducerExpertId, null);
    assert.equal(parsed.coproducerShareBasisPoints, 4_000);
  });

  it("bloqueia coprodutor Expert com mensagem clara", () => {
    assert.throws(
      () =>
        parseProductAdminInput({
          ownerType: "expert",
          expertId: "11111111-1111-4111-8111-111111111111",
          title: "Produto",
          priceCentavos: 1000,
          hasCoproduction: true,
          coproducerType: "expert",
          coproducerExpertId: "22222222-2222-4222-8222-222222222222",
          coproducerSharePercent: 40,
        }),
      /Coprodutor Expert não é permitido/,
    );
  });

  it("ignores the legacy product platform fee override", () => {
    const parsed = parseProductAdminInput({
      ownerType: "automatize",
      title: "Produto personalizado",
      priceCentavos: 1000,
      platformFeePercentOverride: 3.5,
    });

    assert.equal("platformFeeBasisPointsOverride" in parsed, false);
  });

  it("accepts an internal R2-backed product cover URL", () => {
    const parsed = parseProductAdminInput({
      ownerType: "automatize",
      title: "Produto",
      priceCentavos: 1000,
      coverUrl:
        "/api/products/assets?key=r2%2Fproduct-covers%2Fcover-123.webp",
    });

    assert.equal(
      parsed.coverUrl,
      "/api/products/assets?key=r2%2Fproduct-covers%2Fcover-123.webp",
    );
  });

  it("rejects arbitrary relative cover paths", () => {
    assert.throws(() =>
      parseProductAdminInput({
        ownerType: "automatize",
        title: "Produto",
        priceCentavos: 1000,
        coverUrl: "/api/private/secrets",
      }),
    );
  });
});

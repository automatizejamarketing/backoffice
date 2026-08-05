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
        expertSharePercent: 35,
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
        expertShareBasisPoints: 0,
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

  it("requires an expert and valid revenue share for expert products", () => {
    assert.throws(() =>
      parseProductAdminInput({
        ownerType: "expert",
        title: "Produto",
        slug: "produto",
        priceCentavos: 1000,
        expertSharePercent: 35,
      }), /expert/);
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

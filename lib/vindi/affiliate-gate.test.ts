import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  affiliateStatusForSaleGate,
  catalogSalesEnabled,
  describeExpertAffiliateReadiness,
  evaluateExpertProductSaleGate,
  mapVindiAffiliateStatus,
} from "./affiliate-gate";

describe("mapVindiAffiliateStatus", () => {
  it("maps Vindi verification strings onto the stored affiliate status", () => {
    assert.equal(mapVindiAffiliateStatus("pending_approval"), "pending");
    assert.equal(mapVindiAffiliateStatus("pending"), "pending");
    assert.equal(mapVindiAffiliateStatus("active"), "verified");
    assert.equal(mapVindiAffiliateStatus("verified"), "verified");
    assert.equal(mapVindiAffiliateStatus("blocked"), "rejected");
    assert.equal(mapVindiAffiliateStatus("rejected"), "rejected");
    assert.equal(mapVindiAffiliateStatus("inactive"), "rejected");
  });

  it("treats a missing or unknown Vindi status as unverified", () => {
    assert.equal(mapVindiAffiliateStatus(undefined), "unverified");
    assert.equal(mapVindiAffiliateStatus(null), "unverified");
    assert.equal(mapVindiAffiliateStatus(""), "unverified");
    assert.equal(mapVindiAffiliateStatus("mystery"), "unverified");
    assert.equal(mapVindiAffiliateStatus(1), "unverified");
  });
});

describe("affiliateStatusForSaleGate", () => {
  it("keeps an explicit affiliate status", () => {
    assert.equal(
      affiliateStatusForSaleGate({
        ownerType: "expert",
        affiliateStatus: "verified",
      }),
      "verified",
    );
  });

  it("treats a missing expert affiliate as unverified", () => {
    assert.equal(
      affiliateStatusForSaleGate({
        ownerType: "expert",
        affiliateStatus: null,
      }),
      "unverified",
    );
    assert.equal(
      affiliateStatusForSaleGate({
        ownerType: "expert",
        affiliateStatus: undefined,
      }),
      "unverified",
    );
  });

  it("leaves Automatize-owned products without an affiliate status", () => {
    assert.equal(
      affiliateStatusForSaleGate({
        ownerType: "automatize",
        affiliateStatus: null,
      }),
      null,
    );
  });
});

describe("describeExpertAffiliateReadiness", () => {
  it("is ready only when the affiliate is verified", () => {
    assert.deepEqual(describeExpertAffiliateReadiness("verified"), {
      ready: true,
    });
  });

  it("says the affiliate is missing and what to do next", () => {
    const unreadiness = describeExpertAffiliateReadiness("unverified");
    assert.equal(unreadiness.ready, false);
    if (unreadiness.ready) throw new Error("expected a block");
    assert.equal(unreadiness.code, "affiliate_missing");
    assert.match(unreadiness.message, /não pode vender/i);
    assert.match(unreadiness.missing, /crie o afiliado vindi/i);
    assert.match(unreadiness.missing, /5 minutos/i);
  });

  it("says verification is still pending and to wait for the Vindi email", () => {
    const unreadiness = describeExpertAffiliateReadiness("pending");
    assert.equal(unreadiness.ready, false);
    if (unreadiness.ready) throw new Error("expected a block");
    assert.equal(unreadiness.code, "affiliate_pending");
    assert.match(unreadiness.missing, /e-mail da vindi/i);
    assert.match(unreadiness.missing, /5 minutos/i);
  });

  it("says a rejected account must finish Vindi Pagamentos verification", () => {
    const unreadiness = describeExpertAffiliateReadiness("rejected");
    assert.equal(unreadiness.ready, false);
    if (unreadiness.ready) throw new Error("expected a block");
    assert.equal(unreadiness.code, "affiliate_rejected");
    assert.match(unreadiness.missing, /vindi pagamentos/i);
  });

  it("tells the expert what they can do, not to create the affiliate themselves", () => {
    const unreadiness = describeExpertAffiliateReadiness("unverified", "expert");
    assert.equal(unreadiness.ready, false);
    if (unreadiness.ready) throw new Error("expected a block");
    assert.match(unreadiness.missing, /equipe automatize/i);
    assert.doesNotMatch(unreadiness.missing, /^crie o afiliado vindi/i);
  });
});

describe("evaluateExpertProductSaleGate", () => {
  const blockedExpert = {
    ownerType: "expert" as const,
    affiliateStatus: "unverified" as const,
    vindiProductsEnabled: true,
    offeringForSale: true,
  };

  it("never blocks Automatize-owned products", () => {
    assert.deepEqual(
      evaluateExpertProductSaleGate({
        ...blockedExpert,
        ownerType: "automatize",
        affiliateStatus: null,
      }),
      { allowed: true },
    );
  });

  it("leaves the current sale path intact while the products flag is off", () => {
    assert.deepEqual(
      evaluateExpertProductSaleGate({
        ...blockedExpert,
        vindiProductsEnabled: false,
      }),
      { allowed: true },
    );
  });

  it("allows a draft or sales-disabled expert product to be saved", () => {
    assert.deepEqual(
      evaluateExpertProductSaleGate({
        ...blockedExpert,
        offeringForSale: false,
      }),
      { allowed: true },
    );
  });

  it("blocks offering an expert product without a verified affiliate", () => {
    const gate = evaluateExpertProductSaleGate(blockedExpert);
    assert.equal(gate.allowed, false);
    if (gate.allowed) throw new Error("expected a block");
    assert.equal(gate.code, "affiliate_missing");
    assert.match(gate.message, /não pode vender/i);
    assert.match(gate.missing, /crie o afiliado vindi/i);
  });

  it("allows offering an expert product after the affiliate is verified", () => {
    assert.deepEqual(
      evaluateExpertProductSaleGate({
        ...blockedExpert,
        affiliateStatus: "verified",
      }),
      { allowed: true },
    );
  });
});

describe("catalogSalesEnabled", () => {
  const publishedExpert = {
    salesEnabled: true,
    status: "published" as const,
    ownerType: "expert" as const,
    affiliateStatus: "unverified" as const,
    vindiProductsEnabled: true,
  };

  it("keeps the stored flag while the products flag is off", () => {
    assert.equal(
      catalogSalesEnabled({
        ...publishedExpert,
        vindiProductsEnabled: false,
      }),
      true,
    );
  });

  it("hides an expert product that cannot sell yet", () => {
    assert.equal(catalogSalesEnabled(publishedExpert), false);
  });

  it("keeps a verified expert product for sale", () => {
    assert.equal(
      catalogSalesEnabled({
        ...publishedExpert,
        affiliateStatus: "verified",
      }),
      true,
    );
  });
});

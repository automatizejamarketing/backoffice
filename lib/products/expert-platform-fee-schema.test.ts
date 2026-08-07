import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expertProfile, productOrder } from "@/lib/db/schema";

describe("expert platform fee schema", () => {
  it("exposes expert fee configuration and the fixed order snapshot", () => {
    assert.ok(expertProfile.platformFeeBasisPoints);
    assert.ok(expertProfile.platformFeeFixedCentavos);
    assert.ok(productOrder.platformFeeFixedCentavos);
  });
});

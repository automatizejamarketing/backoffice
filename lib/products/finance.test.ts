import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateAutomatizeNetRevenueCentavos,
  calculateExpertShare,
} from "./finance";

describe("product financial summary", () => {
  it("keeps the full net settlement for Automatize products", () => {
    assert.equal(calculateAutomatizeNetRevenueCentavos(8_614, 0), 8_614);
  });

  it("subtracts the expert ledger share from the net settlement", () => {
    assert.equal(calculateAutomatizeNetRevenueCentavos(8_614, 8_183), 431);
  });

  it("derives expert share from net settlement basis points", () => {
    assert.equal(calculateExpertShare(8_614, 9_500), 8_183);
  });

  it("rejects inconsistent negative totals", () => {
    assert.throws(
      () => calculateAutomatizeNetRevenueCentavos(1_000, 1_001),
      /expert revenue cannot exceed net revenue/i,
    );
  });
});

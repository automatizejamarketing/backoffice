import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseProductFinancialSettingsInput } from "./financial-settings";

describe("product financial settings input", () => {
  it("converts a platform percentage to basis points", () => {
    assert.deepEqual(
      parseProductFinancialSettingsInput({ platformFeePercent: 5 }),
      { platformFeeBasisPoints: 500 },
    );
  });

  it("accepts decimal percentages and rejects invalid rates", () => {
    assert.equal(
      parseProductFinancialSettingsInput({ platformFeePercent: 4.75 })
        .platformFeeBasisPoints,
      475,
    );
    assert.throws(() =>
      parseProductFinancialSettingsInput({ platformFeePercent: 101 }),
    );
  });
});

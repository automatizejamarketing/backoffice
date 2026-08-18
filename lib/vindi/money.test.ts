import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { centavosToVindiAmount, vindiAmountToCentavos } from "./money";

describe("Vindi money", () => {
  it("formats the closed split example as a two-decimal string", () => {
    assert.equal(centavosToVindiAmount(7_561), "75.61");
    assert.equal(centavosToVindiAmount(10_000), "100.00");
    assert.equal(centavosToVindiAmount(0), "0.00");
  });

  it("reads API amounts that come back as strings or numbers", () => {
    assert.equal(vindiAmountToCentavos("75.61"), 7_561);
    assert.equal(vindiAmountToCentavos("100.0"), 10_000);
    assert.equal(vindiAmountToCentavos(150), 15_000);
  });
});

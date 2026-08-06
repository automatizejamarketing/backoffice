import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBrlCurrencyFromCentavos,
  formatBrlCurrencyInput,
  parseBrlCurrencyToCentavos,
} from "./currency-input";

describe("BRL currency input", () => {
  it("keeps a new field empty", () => {
    assert.equal(formatBrlCurrencyInput(""), "");
  });

  it("formats typed digits as Brazilian currency", () => {
    assert.equal(formatBrlCurrencyInput("12990"), "R$ 129,90");
    assert.equal(formatBrlCurrencyFromCentavos(12990), "R$ 129,90");
  });

  it("converts the formatted value back to centavos", () => {
    assert.equal(parseBrlCurrencyToCentavos("R$ 129,90"), 12990);
  });
});

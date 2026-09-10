import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatProductParticipationInput,
  formatPercentageInput,
  parseOptionalPercentageInput,
  parsePercentageInput,
} from "./percentage-input";

describe("percentage input", () => {
  it("keeps the percent sign visible while typing", () => {
    assert.equal(formatPercentageInput("40"), "40%");
    assert.equal(formatPercentageInput("40%"), "40%");
    assert.equal(formatPercentageInput("12,5"), "12,5%");
  });

  it("caps the visible value at 100 and parses the number", () => {
    assert.equal(formatPercentageInput("150"), "100%");
    assert.equal(parsePercentageInput("40,5%"), 40.5);
  });

  it("allows an empty field", () => {
    assert.equal(formatPercentageInput(""), "");
    assert.equal(parsePercentageInput(""), 0);
  });

  it("keeps product participation validation visible instead of capping 100%", () => {
    assert.equal(formatProductParticipationInput("99,999"), "99,99%");
    assert.equal(formatProductParticipationInput("100"), "100%");
    assert.equal(parseOptionalPercentageInput(""), null);
    assert.equal(parseOptionalPercentageInput("99,99%"), 99.99);
  });
});

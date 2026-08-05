import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPercentageInput,
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
});

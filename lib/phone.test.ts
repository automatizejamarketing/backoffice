import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBrazilianPhoneInput } from "./phone";

describe("Brazilian phone input mask", () => {
  it("formats a mobile number progressively", () => {
    assert.equal(formatBrazilianPhoneInput("1"), "(1");
    assert.equal(formatBrazilianPhoneInput("11999998888"), "(11) 99999-8888");
  });

  it("formats landlines and ignores non-digit characters", () => {
    assert.equal(formatBrazilianPhoneInput("11 3333-4444"), "(11) 3333-4444");
  });

  it("removes the Brazilian country code from pasted numbers", () => {
    assert.equal(
      formatBrazilianPhoneInput("+55 (11) 99999-8888"),
      "(11) 99999-8888",
    );
  });
});

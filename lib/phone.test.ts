import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBrazilianPhoneInput, getWhatsAppUrl } from "./phone";

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

describe("getWhatsAppUrl", () => {
  it("accepts canonical 10-11 digit numbers", () => {
    assert.equal(getWhatsAppUrl("11999998888"), "https://wa.me/5511999998888");
  });

  it("accepts numbers stored with +55 country code", () => {
    assert.equal(
      getWhatsAppUrl("+5551995558112"),
      "https://wa.me/5551995558112",
    );
  });

  it("returns null for missing phone", () => {
    assert.equal(getWhatsAppUrl(null), null);
  });

  it("appends a pre-filled message when provided", () => {
    assert.equal(
      getWhatsAppUrl("11999998888", "Olá!"),
      "https://wa.me/5511999998888?text=Ol%C3%A1!",
    );
  });
});

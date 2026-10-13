import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeMediaLibraryState } from "./media-library-state";

describe("describeMediaLibraryState", () => {
  it("ativa mostra até quando em DD/MM/AAAA", () => {
    assert.match(
      describeMediaLibraryState({ state: "active", expirationDate: "2026-10-24T19:57:52.463Z", purgeAt: "2026-11-24T19:57:52.463Z" }),
      /^Ativa até \d{2}\/\d{2}\/\d{4}$/,
    );
    assert.equal(
      describeMediaLibraryState({ state: "active", expirationDate: "2026-10-24T19:57:52.463Z", purgeAt: "2026-11-24T19:57:52.463Z" }),
      "Ativa até 24/10/2026",
    );
  });
  it("ativa: o dia é o de São Paulo, não o de UTC", () => {
    // 02:59:59.999Z de 25/10 ainda é 23:59:59.999 de 24/10 em São Paulo (UTC-3).
    assert.equal(
      describeMediaLibraryState({ state: "active", expirationDate: "2026-10-25T02:59:59.999Z", purgeAt: "2026-11-25T02:59:59.999Z" }),
      "Ativa até 24/10/2026",
    );
    // 03:00:00Z já é 00:00 de 25/10 em São Paulo.
    assert.equal(
      describeMediaLibraryState({ state: "active", expirationDate: "2026-10-25T03:00:00.000Z", purgeAt: "2026-11-25T03:00:00.000Z" }),
      "Ativa até 25/10/2026",
    );
  });
  it("ativa sem data = acesso liberado sem cobrança", () => {
    assert.equal(describeMediaLibraryState({ state: "active", expirationDate: null, purgeAt: null }), "Ativa (acesso liberado sem cobrança)");
  });
  it("carência mostra a data da exclusão em DD/MM/AAAA", () => {
    assert.match(
      describeMediaLibraryState({ state: "grace", expirationDate: "2026-10-03T12:00:00.000Z", purgeAt: "2026-11-03T12:00:00.000Z" }),
      /^Carência — exclusão em \d{2}\/\d{2}\/\d{4}$/,
    );
    assert.equal(
      describeMediaLibraryState({ state: "grace", expirationDate: "2026-10-03T12:00:00.000Z", purgeAt: "2026-11-03T12:00:00.000Z" }),
      "Carência — exclusão em 03/11/2026",
    );
  });
  it("encerrada explica", () => {
    assert.equal(describeMediaLibraryState({ state: "closed", expirationDate: null, purgeAt: null }), "Encerrada — o cliente precisa renovar o acesso");
  });
});

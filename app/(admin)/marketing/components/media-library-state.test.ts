import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeMediaLibraryState } from "./media-library-state";

describe("describeMediaLibraryState", () => {
  it("ativa mostra até quando", () => {
    assert.match(describeMediaLibraryState({ state: "active", expirationDate: "2026-10-24T19:57:52.463Z", purgeAt: "2026-11-24T19:57:52.463Z" }), /^Ativa até /);
  });
  it("ativa sem data = acesso liberado sem cobrança", () => {
    assert.equal(describeMediaLibraryState({ state: "active", expirationDate: null, purgeAt: null }), "Ativa (acesso liberado sem cobrança)");
  });
  it("carência mostra a data da exclusão", () => {
    assert.match(describeMediaLibraryState({ state: "grace", expirationDate: "2026-10-03T12:00:00.000Z", purgeAt: "2026-11-03T12:00:00.000Z" }), /^Carência — exclusão em /);
  });
  it("encerrada explica", () => {
    assert.equal(describeMediaLibraryState({ state: "closed", expirationDate: null, purgeAt: null }), "Encerrada — o cliente precisa renovar o acesso");
  });
});

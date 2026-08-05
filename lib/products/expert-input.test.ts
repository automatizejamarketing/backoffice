import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseExpertAdminInput } from "./expert-input";

describe("expert admin input", () => {
  it("normalizes editable expert fields", () => {
    assert.deepEqual(
      parseExpertAdminInput({
        displayName: "  Dudu Bastos ",
        phone: "+55 (22) 99923-2116",
        pixKey: " contato@bernardohaddad.com.br ",
        status: "active",
      }),
      {
        displayName: "Dudu Bastos",
        phone: "22999232116",
        pixKey: "contato@bernardohaddad.com.br",
        status: "active",
      },
    );
  });

  it("rejects an incomplete phone number", () => {
    assert.throws(
      () =>
        parseExpertAdminInput({
          displayName: "Dudu Bastos",
          phone: "22999",
          pixKey: "pix@example.com",
        }),
      /WhatsApp/,
    );
  });
});

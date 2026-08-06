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
        profileImageUrl:
          "/api/products/assets?key=r2%2Fexpert-avatars%2Ffoto.webp",
        status: "active",
      }),
      {
        displayName: "Dudu Bastos",
        phone: "22999232116",
        pixKey: "contato@bernardohaddad.com.br",
        profileImageUrl:
          "/api/products/assets?key=r2%2Fexpert-avatars%2Ffoto.webp",
        status: "active",
      },
    );
  });

  it("accepts an empty profile image and rejects other asset prefixes", () => {
    assert.equal(
      parseExpertAdminInput({
        displayName: "Dudu Bastos",
        pixKey: "pix@example.com",
        profileImageUrl: "",
      }).profileImageUrl,
      null,
    );

    assert.throws(
      () =>
        parseExpertAdminInput({
          displayName: "Dudu Bastos",
          pixKey: "pix@example.com",
          profileImageUrl:
            "/api/products/assets?key=r2%2Fproducts%2Fmaterial.pdf",
        }),
      /foto de perfil/i,
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

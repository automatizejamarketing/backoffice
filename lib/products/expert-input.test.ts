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

  it("converts the expert platform fee to persistence values", () => {
    assert.deepEqual(
      parseExpertAdminInput({
        displayName: "Dudu Bastos",
        pixKey: "pix@example.com",
        platformFeePercent: 5.49,
        platformFeeFixedCentavos: 39,
      }),
      {
        displayName: "Dudu Bastos",
        phone: null,
        pixKey: "pix@example.com",
        profileImageUrl: null,
        status: "active",
        platformFeeBasisPoints: 549,
        platformFeeFixedCentavos: 39,
      },
    );
  });

  it("rejects invalid expert platform fee components", () => {
    const base = {
      displayName: "Dudu Bastos",
      pixKey: "pix@example.com",
    };

    assert.throws(
      () => parseExpertAdminInput({ ...base, platformFeePercent: 100.01 }),
      /platformFeePercent/,
    );
    assert.throws(
      () =>
        parseExpertAdminInput({
          ...base,
          platformFeeFixedCentavos: -1,
        }),
      /platformFeeFixedCentavos/,
    );
  });
});

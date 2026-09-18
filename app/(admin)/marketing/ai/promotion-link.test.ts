import { describe, expect, test } from "bun:test";

import { isValidPromotionLink, promotionLinkPolicy } from "./promotion-link";

describe("promotionLinkPolicy", () => {
  test("vendas: o link é obrigatório — com mídia externa ou com post do Instagram", () => {
    expect(promotionLinkPolicy("sales")).toBe("required");
  });

  test("leads: o campo aparece, mas o servidor não o usa — opcional", () => {
    expect(promotionLinkPolicy("leads")).toBe("optional");
  });

  test("whatsapp e seguidores não têm link de destino", () => {
    expect(promotionLinkPolicy("whatsapp")).toBe("hidden");
    expect(promotionLinkPolicy("followers")).toBe("hidden");
  });
});

describe("isValidPromotionLink", () => {
  test("aceita http e https", () => {
    expect(isValidPromotionLink("https://loja.com.br/promo")).toBe(true);
    expect(isValidPromotionLink("http://loja.com.br")).toBe(true);
  });

  test("recusa vazio, só espaços e texto sem esquema", () => {
    expect(isValidPromotionLink("")).toBe(false);
    expect(isValidPromotionLink("   ")).toBe(false);
    expect(isValidPromotionLink("loja.com.br/promo")).toBe(false);
  });

  test("recusa esquemas que não abrem página", () => {
    expect(isValidPromotionLink("mailto:oi@loja.com")).toBe(false);
    expect(isValidPromotionLink("javascript:alert(1)")).toBe(false);
  });
});

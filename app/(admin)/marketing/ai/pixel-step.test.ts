import { describe, expect, test } from "bun:test";

import {
  PIXEL_NAME_MAX_LENGTH,
  buildPixelBaseCode,
  isJustCreatedPixel,
  pixelStepState,
  suggestPixelName,
} from "./pixel-step";

const base = { loaded: true, error: null, pixels: [], selectedPixelId: null, createdPixelId: null };

describe("pixelStepState", () => {
  test("antes da leitura terminar, carregando", () => {
    expect(pixelStepState({ ...base, loaded: false })).toEqual({ kind: "loading" });
  });

  test("leitura que falhou NUNCA vira 'nenhum pixel' — criar por cima duplicaria", () => {
    expect(pixelStepState({ ...base, error: "A conexão expirou." })).toEqual({
      kind: "error",
      message: "A conexão expirou.",
    });
  });

  test("leitura boa e vazia oferece criar", () => {
    expect(pixelStepState(base)).toEqual({ kind: "empty" });
  });

  test("com pixels, lista; marca o recém-criado quando é o selecionado", () => {
    const pixels = [{ id: "PX1" }];
    expect(pixelStepState({ ...base, pixels, selectedPixelId: "PX1" })).toEqual({
      kind: "list",
      justCreated: false,
    });
    expect(
      pixelStepState({ ...base, pixels, selectedPixelId: "PX1", createdPixelId: "PX1" }),
    ).toEqual({ kind: "list", justCreated: true });
  });
});

describe("isJustCreatedPixel", () => {
  test("só quando o selecionado é o que acabou de ser criado", () => {
    expect(isJustCreatedPixel("PX1", "PX1")).toBe(true);
    expect(isJustCreatedPixel("PX2", "PX1")).toBe(false);
    expect(isJustCreatedPixel("PX1", null)).toBe(false);
    expect(isJustCreatedPixel(null, null)).toBe(false);
  });
});

describe("suggestPixelName", () => {
  test("usa o nome da conta", () => {
    expect(suggestPixelName("Loja do Zé", "123")).toBe("Pixel – Loja do Zé");
  });

  test("sem nome, cai no id da conta", () => {
    expect(suggestPixelName(null, "123")).toBe("Pixel – 123");
    expect(suggestPixelName("   ", "123")).toBe("Pixel – 123");
  });

  test("nunca passa do limite que a rota aceita", () => {
    expect(suggestPixelName("x".repeat(300), "123")).toHaveLength(PIXEL_NAME_MAX_LENGTH);
  });
});

describe("buildPixelBaseCode", () => {
  test("é o código-base da Meta com o id no init e no noscript", () => {
    const code = buildPixelBaseCode("987654321");
    expect(code).toContain("https://connect.facebook.net/en_US/fbevents.js");
    expect(code).toContain("fbq('init', '987654321');");
    expect(code).toContain("fbq('track', 'PageView');");
    expect(code).toContain("https://www.facebook.com/tr?id=987654321&ev=PageView&noscript=1");
  });
});

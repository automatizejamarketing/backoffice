import { describe, expect, test } from "bun:test";
import { normalizePixInitPoint } from "./pix-link-view";

describe("normalizePixInitPoint", () => {
  test("keeps a legacy Pix link with a null init point renderable", () => {
    expect(normalizePixInitPoint(null)).toEqual({
      initPoint: "",
      pixCopyPasteCode: undefined,
    });
  });

  test("exposes an EMV payload as the copy-and-paste code", () => {
    const payload = "00020101021226890014br.gov.bcb.pix";

    expect(normalizePixInitPoint(payload)).toEqual({
      initPoint: payload,
      pixCopyPasteCode: payload,
    });
  });

  // Link criado pelo app: o EMV está em `pix_copy_paste` e `init_point` é null.
  // Antes de 06/09/2026 a tela mostrava esses links sem código para copiar.
  test("reads the EMV from pix_copy_paste when init_point is null", () => {
    const payload = "00020101021226890014br.gov.bcb.pix";

    expect(normalizePixInitPoint(null, payload)).toEqual({
      initPoint: "",
      pixCopyPasteCode: payload,
    });
  });

  test("prefers the dedicated column over a legacy init_point", () => {
    expect(
      normalizePixInitPoint("https://mercadopago.com/checkout/antigo", "000201abc"),
    ).toEqual({
      initPoint: "https://mercadopago.com/checkout/antigo",
      pixCopyPasteCode: "000201abc",
    });
  });

  test("ignores an empty pix_copy_paste", () => {
    expect(normalizePixInitPoint(null, "   ")).toEqual({
      initPoint: "",
      pixCopyPasteCode: undefined,
    });
  });
});

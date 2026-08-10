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
});

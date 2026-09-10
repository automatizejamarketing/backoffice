import { describe, expect, test } from "bun:test";
import {
  getPixLinkState,
  normalizePixInitPoint,
  pickLatestPixCharge,
} from "./pix-link-view";

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

describe("getPixLinkState", () => {
  const now = new Date("2026-09-09T15:00:00.000Z");

  test("a pending link still inside its validity is awaiting payment", () => {
    expect(
      getPixLinkState(
        { status: "pending", expiresAt: "2026-09-10T12:00:00.000Z" },
        now,
      ),
    ).toBe("awaiting");
  });

  // O cron só expira ao meio-dia; antes disso a linha ainda diz `pending`
  // mesmo com `expires_at` no passado. Para o operador ela já morreu sem pagar.
  test("a pending link past expires_at is expired without payment", () => {
    expect(
      getPixLinkState(
        { status: "pending", expiresAt: "2026-09-09T12:00:00.000Z" },
        now,
      ),
    ).toBe("expired_unpaid");
  });

  test("maps approved, expired and canceled rows", () => {
    expect(
      getPixLinkState({ status: "approved", expiresAt: "2026-08-12T00:00:00Z" }, now),
    ).toBe("paid");
    expect(
      getPixLinkState({ status: "expired", expiresAt: "2026-08-12T00:00:00Z" }, now),
    ).toBe("expired_unpaid");
    expect(
      getPixLinkState({ status: "canceled", expiresAt: "2026-08-12T00:00:00Z" }, now),
    ).toBe("canceled");
  });
});

describe("pickLatestPixCharge", () => {
  const now = new Date("2026-09-09T15:00:00.000Z");

  test("returns null without links", () => {
    expect(pickLatestPixCharge([], now)).toBeNull();
  });

  test("picks the most recently created link regardless of input order", () => {
    const paid = {
      id: "paid",
      status: "approved",
      expiresAt: "2026-08-12T20:07:46.549Z",
      createdAt: "2026-08-05T20:07:47.519Z",
    };
    const renewal = {
      id: "renewal",
      status: "pending",
      expiresAt: "2026-09-09T12:00:29.941Z",
      createdAt: "2026-09-02T12:00:31.414Z",
    };
    expect(pickLatestPixCharge([paid, renewal], now)).toEqual({
      link: renewal,
      state: "expired_unpaid",
    });
  });
});

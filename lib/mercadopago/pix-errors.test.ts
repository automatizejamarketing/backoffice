import assert from "node:assert/strict";
import test from "node:test";
import { formatMercadoPagoPixError } from "./pix-errors";

test("formatMercadoPagoPixError translates known Pix availability errors", () => {
  assert.match(
    formatMercadoPagoPixError(
      "Pix is not enabled for this Mercado Pago account. Register a Pix key or use credentials from an account with Pix enabled.",
    ),
    /Pix não está habilitado/,
  );
});

test("formatMercadoPagoPixError keeps unknown messages", () => {
  assert.equal(
    formatMercadoPagoPixError("Erro customizado"),
    "Erro customizado",
  );
});

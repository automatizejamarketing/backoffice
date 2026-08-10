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

test("formatMercadoPagoPixError parses Mercado Pago JSON errors", () => {
  assert.match(
    formatMercadoPagoPixError(
      JSON.stringify({
        message: "Unauthorized use of live credentials",
        cause: [{ description: "Unauthorized use of live credentials" }],
      }),
    ),
    // A causa aninhada é o que vira mensagem — e ela aponta a conta certa a usar.
    /sem permissão para Pix via API/,
  );
});

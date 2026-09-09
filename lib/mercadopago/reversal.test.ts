import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readMercadoPagoRefundedAmountCentavos } from "./reversal";

describe("Mercado Pago refund observation", () => {
  it("prefers the cumulative provider amount", () => {
    assert.equal(
      readMercadoPagoRefundedAmountCentavos({
        status: "approved",
        transaction_amount_refunded: 12.34,
        refunds: [{ amount: 1 }],
      }),
      1234,
    );
  });

  it("uses the terminal payment amount only when the provider reports a full reversal", () => {
    assert.equal(
      readMercadoPagoRefundedAmountCentavos({
        status: "refunded",
        transaction_amount: 20,
      }),
      2000,
    );
  });

  it("keeps an approved payment with no observed refund at zero", () => {
    assert.equal(
      readMercadoPagoRefundedAmountCentavos({ status: "approved" }),
      0,
    );
  });
});

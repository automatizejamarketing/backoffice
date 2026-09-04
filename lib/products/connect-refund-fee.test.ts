import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateProportionalRefundApplicationFee } from "./connect-refund-fee";

describe("Coprodução do Automatize — refund_application_fee proporcional", () => {
  it("devolve a application_fee inteira no reembolso total", () => {
    assert.equal(
      calculateProportionalRefundApplicationFee({
        refundAmountCentavos: 10_000,
        grossAmountCentavos: 10_000,
        applicationFeeCentavos: 1_912,
      }),
      1_912,
    );
  });

  it("arredonda half-up (R$100 com fee 1_912, parcial R$30 → 574)", () => {
    assert.equal(
      calculateProportionalRefundApplicationFee({
        refundAmountCentavos: 3_000,
        grossAmountCentavos: 10_000,
        applicationFeeCentavos: 1_912,
      }),
      574,
    );
  });
});

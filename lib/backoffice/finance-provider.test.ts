import assert from "node:assert/strict";
import test from "node:test";
import {
  UNCLASSIFIED_FINANCE_PROVIDER_LABEL,
  financeProvider,
  financeProviderLabel,
} from "./finance-provider";

test("financeProvider maps Stripe to card, Mercado Pago to pix, and manual to manual", () => {
  assert.equal(financeProvider({ provider: "stripe" }), "card");
  assert.equal(financeProvider({ provider: "mercadopago" }), "pix");
  assert.equal(financeProvider({ provider: "manual" }), "manual");
});

test("financeProvider leaves historical Vindi rows unclassified so listings keep them", () => {
  assert.equal(financeProvider({ provider: "vindi" }), null);
  assert.equal(
    financeProvider({ provider: "vindi", paymentMethod: "credit_card" }),
    null,
  );
  assert.equal(
    financeProvider({ provider: "vindi", paymentMethod: "pix" }),
    null,
  );
});

test("financeProviderLabel never names Vindi", () => {
  assert.equal(financeProviderLabel({ provider: "stripe" }), "Cartão");
  assert.equal(financeProviderLabel({ provider: "mercadopago" }), "PIX");
  assert.equal(financeProviderLabel({ provider: "manual" }), "Manual");
  assert.equal(
    financeProviderLabel({ provider: "vindi", paymentMethod: "credit_card" }),
    UNCLASSIFIED_FINANCE_PROVIDER_LABEL,
  );
  assert.equal(UNCLASSIFIED_FINANCE_PROVIDER_LABEL, "sem classificação");
  assert.doesNotMatch(
    financeProviderLabel({ provider: "vindi" }),
    /vindi/i,
  );
});

import assert from "node:assert/strict";
import type { BillingProvider } from "@/lib/db/schema";
import test from "node:test";
import {
  UNCLASSIFIED_FINANCE_PROVIDER_LABEL,
  financeProvider,
  financeProviderLabel,
} from "./finance-provider";

/** Provedor que o domínio não conhece mais: a coluna é varchar, não enum do banco,
 *  então uma linha antiga pode trazer qualquer string e a UI tem que degradar. */
const HISTORICAL_PROVIDER = "legacy_gateway" as BillingProvider;

test("financeProvider maps Stripe to card, Mercado Pago to pix, and manual to manual", () => {
  assert.equal(financeProvider({ provider: "stripe" }), "card");
  assert.equal(financeProvider({ provider: "mercadopago" }), "pix");
  assert.equal(financeProvider({ provider: "manual" }), "manual");
});

test("financeProvider leaves rows of an unknown provider unclassified so listings keep them", () => {
  assert.equal(financeProvider({ provider: HISTORICAL_PROVIDER }), null);
  assert.equal(
    financeProvider({ provider: HISTORICAL_PROVIDER, paymentMethod: "credit_card" }),
    null,
  );
  assert.equal(
    financeProvider({ provider: HISTORICAL_PROVIDER, paymentMethod: "pix" }),
    null,
  );
});

test("financeProviderLabel never names the raw provider", () => {
  assert.equal(financeProviderLabel({ provider: "stripe" }), "Cartão");
  assert.equal(financeProviderLabel({ provider: "mercadopago" }), "PIX");
  assert.equal(financeProviderLabel({ provider: "manual" }), "Manual");
  assert.equal(
    financeProviderLabel({ provider: HISTORICAL_PROVIDER, paymentMethod: "credit_card" }),
    UNCLASSIFIED_FINANCE_PROVIDER_LABEL,
  );
  assert.equal(UNCLASSIFIED_FINANCE_PROVIDER_LABEL, "sem classificação");
  assert.doesNotMatch(
    financeProviderLabel({ provider: HISTORICAL_PROVIDER }),
    /legacy_gateway/i,
  );
});

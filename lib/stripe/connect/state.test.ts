import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveExpertStripeAccountState } from "./state";

describe("estado da Conta Stripe do Expert (decisão pura)", () => {
  it("sem id da conta → não conectada", () => {
    assert.deepEqual(
      deriveExpertStripeAccountState({
        stripeAccountId: null,
        stripeChargesEnabled: false,
      }),
      { status: "not_connected" },
    );
  });

  it("com id e sem cobranças → conectada sem cobranças", () => {
    assert.deepEqual(
      deriveExpertStripeAccountState({
        stripeAccountId: "acct_expert_1",
        stripeChargesEnabled: false,
      }),
      {
        status: "connected_without_charges",
        stripeAccountId: "acct_expert_1",
      },
    );
  });

  it("com id e charges_enabled → habilitada", () => {
    assert.deepEqual(
      deriveExpertStripeAccountState({
        stripeAccountId: "acct_expert_1",
        stripeChargesEnabled: true,
      }),
      {
        status: "enabled",
        stripeAccountId: "acct_expert_1",
      },
    );
  });
});

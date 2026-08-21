import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSubscribeLinkUrl,
  getSubscribeLinkDisabledReason,
} from "./subscribe-link-policy";

const NOW = new Date("2026-08-21T12:00:00Z");
const FUTURE = new Date("2026-09-21T12:00:00Z");
const PAST = new Date("2026-07-21T12:00:00Z");

describe("getSubscribeLinkDisabledReason", () => {
  it("allows a user who never subscribed", () => {
    assert.equal(
      getSubscribeLinkDisabledReason({
        expirationDate: null,
        subscriptions: [],
        now: NOW,
      }),
      null,
    );
  });

  it("allows a churned user whose access expired", () => {
    assert.equal(
      getSubscribeLinkDisabledReason({
        expirationDate: PAST,
        subscriptions: [{ provider: "vindi", status: "canceled" }],
        now: NOW,
      }),
      null,
    );
  });

  it("blocks an active plan, including serialized dates", () => {
    for (const expirationDate of [FUTURE, FUTURE.toISOString()]) {
      assert.match(
        getSubscribeLinkDisabledReason({
          expirationDate,
          subscriptions: [],
          now: NOW,
        }) ?? "",
        /plano ativo/,
      );
    }
  });

  it("blocks live Stripe and Vindi subscriptions even without access", () => {
    for (const provider of ["stripe", "vindi"]) {
      for (const status of ["active", "trialing", "past_due"]) {
        assert.match(
          getSubscribeLinkDisabledReason({
            expirationDate: PAST,
            subscriptions: [{ provider, status }],
            now: NOW,
          }) ?? "",
          /Stripe ou Vindi ativa/,
        );
      }
    }
  });

  it("treats a null provider as Stripe (fail-closed)", () => {
    assert.notEqual(
      getSubscribeLinkDisabledReason({
        expirationDate: null,
        subscriptions: [{ provider: null, status: "active" }],
        now: NOW,
      }),
      null,
    );
  });

  it("does not block prepaid Mercado Pago/manual subscriptions", () => {
    for (const provider of ["mercadopago", "manual"]) {
      assert.equal(
        getSubscribeLinkDisabledReason({
          expirationDate: PAST,
          subscriptions: [{ provider, status: "active" }],
          now: NOW,
        }),
        null,
      );
    }
  });
});

describe("buildSubscribeLinkUrl", () => {
  it("points at /pagar/<token> on the frontend origin", () => {
    assert.equal(
      buildSubscribeLinkUrl("abc123", "https://staging.automatizemarketing.com "),
      "https://staging.automatizemarketing.com/pagar/abc123",
    );
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildAccountHistory,
  describeAccountHistoryItem,
} from "./account-history";

describe("buildAccountHistory", () => {
  test("orders newest first and maps signup, trial, payment, cancel, and admin change", () => {
    const items = buildAccountHistory({
      userId: "user-1",
      createdAt: "2026-07-01T12:00:00.000Z",
      emailVerified: "2026-07-01T12:00:01.000Z",
      trialGrants: [{ id: "trial-1", createdAt: "2026-07-01T12:05:00.000Z" }],
      payments: [
        {
          id: "pay-1",
          status: "succeeded",
          paidAt: "2026-07-25T22:37:00.000Z",
          createdAt: "2026-07-25T22:37:00.000Z",
          planType: "monthly_starter",
          amount: 29700,
          currency: "brl",
          provider: "mercadopago",
        },
      ],
      events: [
        {
          id: "evt-sub",
          eventType: "subscribed",
          fromPlan: null,
          toPlan: "monthly_starter",
          createdAt: "2026-07-25T22:37:20.000Z",
        },
        {
          id: "evt-cancel",
          eventType: "canceled",
          fromPlan: "monthly_starter",
          toPlan: null,
          createdAt: "2026-08-10T10:00:00.000Z",
        },
      ],
      expirationAudits: [
        {
          id: "audit-1",
          adminEmail: "joao@layback.trade",
          oldValue: "2026-07-25T23:59:59.000Z",
          newValue: "2026-08-25T23:59:59.000Z",
          createdAt: "2026-08-20T14:00:00.000Z",
        },
      ],
    });

    assert.deepEqual(
      items.map((item) => item.kind),
      [
        "admin_expiration",
        "subscription_event",
        "payment",
        "trial",
        "created",
      ],
    );
    assert.equal(
      items.find((item) => item.kind === "subscription_event")?.eventType,
      "canceled",
    );
  });

  test("keeps email verification when it is not the signup instant", () => {
    const items = buildAccountHistory({
      userId: "user-1",
      createdAt: "2026-07-01T12:00:00.000Z",
      emailVerified: "2026-07-03T09:00:00.000Z",
      trialGrants: [],
      payments: [],
      events: [],
      expirationAudits: [],
    });

    assert.deepEqual(
      items.map((item) => item.kind),
      ["email_verified", "created"],
    );
  });

  test("uses email verification as account creation when createdAt is missing", () => {
    const items = buildAccountHistory({
      userId: "user-1",
      createdAt: null,
      emailVerified: "2026-07-03T09:00:00.000Z",
      trialGrants: [],
      payments: [],
      events: [],
      expirationAudits: [],
    });

    assert.deepEqual(
      items.map((item) => item.kind),
      ["created"],
    );
  });

  test("maps a trialing subscription to trial when there is no trial grant", () => {
    const items = buildAccountHistory({
      userId: "user-1",
      createdAt: "2026-07-01T12:00:00.000Z",
      emailVerified: null,
      trialGrants: [],
      payments: [],
      events: [],
      expirationAudits: [],
      subscriptions: [
        {
          id: "sub-1",
          status: "trialing",
          planType: "monthly_starter",
          createdAt: "2026-07-01T12:06:00.000Z",
          canceledAt: null,
        },
      ],
    });

    assert.equal(
      items.some((item) => item.kind === "trial"),
      true,
    );
  });
});

describe("describeAccountHistoryItem", () => {
  test("names an admin expiration change", () => {
    const copy = describeAccountHistoryItem({
      id: "audit:1",
      kind: "admin_expiration",
      at: new Date("2026-08-20T14:00:00.000Z"),
      adminEmail: "joao@layback.trade",
      oldValue: "2026-07-25T23:59:59.000Z",
      newValue: "2026-08-25T23:59:59.000Z",
    });

    assert.match(
      copy.title,
      /joao@layback\.trade alterou a data de expiração para/,
    );
    assert.match(copy.detail ?? "", /Antes:/);
  });

  test("names a succeeded payment", () => {
    const copy = describeAccountHistoryItem({
      id: "payment:1",
      kind: "payment",
      at: new Date("2026-07-25T22:37:00.000Z"),
      planType: "monthly_starter",
      amount: 29700,
      currency: "brl",
      provider: "mercadopago",
      status: "succeeded",
    });

    assert.equal(
      copy.title,
      "Pagamento realizado — aumento da data de expiração",
    );
    assert.match(copy.detail ?? "", /Mercado Pago Pix/);
  });

  test("labels a historical unclassified payment without naming Vindi", () => {
    const copy = describeAccountHistoryItem({
      id: "payment:2",
      kind: "payment",
      at: new Date("2026-07-25T22:37:00.000Z"),
      planType: "monthly_starter",
      amount: 29700,
      currency: "brl",
      provider: "vindi",
      status: "succeeded",
    });

    assert.match(copy.detail ?? "", /sem classificação/);
    assert.doesNotMatch(copy.detail ?? "", /vindi/i);
  });
});

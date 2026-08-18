import { describe, expect, test } from "bun:test";
import { getSubscriptionAccessIssue } from "./derive";

const now = new Date("2026-08-09T15:00:00.000Z");

describe("getSubscriptionAccessIssue", () => {
  test("flags an active subscription with expired operational access", () => {
    expect(
      getSubscriptionAccessIssue(
        "stripe",
        "active",
        new Date("2026-08-03T15:00:00.000Z"),
        now,
      ),
    ).toEqual({ kind: "expired", expirationDate: new Date("2026-08-03T15:00:00.000Z") });
  });

  test("flags an active subscription without an operational access date", () => {
    expect(
      getSubscriptionAccessIssue("stripe", "active", null, now),
    ).toEqual({
      kind: "missing",
      expirationDate: null,
    });
  });

  test("flags a trial whose operational access date has expired", () => {
    expect(
      getSubscriptionAccessIssue(
        "stripe",
        "trialing",
        new Date("2026-08-03T15:00:00.000Z"),
        now,
      ),
    ).toEqual({
      kind: "expired",
      expirationDate: new Date("2026-08-03T15:00:00.000Z"),
    });
  });

  test("does not flag active access that is still valid", () => {
    expect(
      getSubscriptionAccessIssue(
        "stripe",
        "active",
        new Date("2026-09-03T15:00:00.000Z"),
        now,
      ),
    ).toBeNull();
  });

  test("does not treat an expired canceled subscription as a sync issue", () => {
    expect(
      getSubscriptionAccessIssue(
        "stripe",
        "canceled",
        new Date("2026-08-03T15:00:00.000Z"),
        now,
      ),
    ).toBeNull();
  });

  test("does not flag expired access for a Mercado Pago Pix renewal", () => {
    expect(
      getSubscriptionAccessIssue(
        "mercadopago",
        "active",
        new Date("2026-08-03T15:00:00.000Z"),
        now,
      ),
    ).toBeNull();
  });
});

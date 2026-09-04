import { describe, expect, test } from "bun:test";
import { matchesAccountStatusFilter } from "@/lib/backoffice/account-status-filter";
import type { AccountStatusCustomer } from "@/lib/backoffice/account-status-filter";

const now = new Date("2026-08-05T12:00:00.000Z");

function customer(
  overrides: Partial<AccountStatusCustomer> = {},
): AccountStatusCustomer {
  return {
    expirationDate: new Date("2026-08-06T12:00:00.000Z"),
    hasApprovedPayment: false,
    scheduledCancel: false,
    lastPaymentProvider: null,
    hasSubscription: false,
    ...overrides,
  };
}

describe("matchesAccountStatusFilter", () => {
  test("no_card_no_payment matches users without payment and without subscription", () => {
    expect(
      matchesAccountStatusFilter(
        customer({
          expirationDate: new Date("2026-08-04T12:00:00.000Z"),
        }),
        "no_card_no_payment",
        now,
      ),
    ).toBe(true);
    expect(
      matchesAccountStatusFilter(
        customer({ expirationDate: null }),
        "no_card_no_payment",
        now,
      ),
    ).toBe(true);
    expect(
      matchesAccountStatusFilter(
        customer({ hasSubscription: true }),
        "no_card_no_payment",
        now,
      ),
    ).toBe(false);
    expect(
      matchesAccountStatusFilter(
        customer({ hasApprovedPayment: true }),
        "no_card_no_payment",
        now,
      ),
    ).toBe(false);
  });

  test("trial_no_payment matches any subscription without approved payment", () => {
    expect(
      matchesAccountStatusFilter(
        customer({ hasSubscription: true }),
        "trial_no_payment",
        now,
      ),
    ).toBe(true);
    expect(
      matchesAccountStatusFilter(
        customer({
          hasSubscription: true,
          expirationDate: new Date("2026-08-04T12:00:00.000Z"),
        }),
        "trial_no_payment",
        now,
      ),
    ).toBe(true);
    expect(
      matchesAccountStatusFilter(customer(), "trial_no_payment", now),
    ).toBe(false);
    expect(
      matchesAccountStatusFilter(
        customer({
          hasSubscription: true,
          hasApprovedPayment: true,
        }),
        "trial_no_payment",
        now,
      ),
    ).toBe(false);
  });

  test("subscribed_expired matches paying users with expired access", () => {
    expect(
      matchesAccountStatusFilter(
        customer({
          hasApprovedPayment: true,
          expirationDate: new Date("2026-08-04T12:00:00.000Z"),
        }),
        "subscribed_expired",
        now,
      ),
    ).toBe(true);
    expect(
      matchesAccountStatusFilter(
        customer({
          hasApprovedPayment: true,
          expirationDate: null,
        }),
        "subscribed_expired",
        now,
      ),
    ).toBe(false);
  });

  test("active_plan matches paying users with active access and no scheduled cancel", () => {
    expect(
      matchesAccountStatusFilter(
        customer({ hasApprovedPayment: true }),
        "active_plan",
        now,
      ),
    ).toBe(true);
    expect(
      matchesAccountStatusFilter(
        customer({
          hasApprovedPayment: true,
          scheduledCancel: true,
        }),
        "active_plan",
        now,
      ),
    ).toBe(false);
  });

  test("active_plan ignores a canceled Stripe leftover when the last payment is Pix", () => {
    expect(
      matchesAccountStatusFilter(
        customer({
          hasApprovedPayment: true,
          scheduledCancel: true,
          lastPaymentProvider: "mercadopago",
        }),
        "active_plan",
        now,
      ),
    ).toBe(true);
    expect(
      matchesAccountStatusFilter(
        customer({
          hasApprovedPayment: true,
          scheduledCancel: true,
          lastPaymentProvider: "mercadopago",
        }),
        "active_plan_canceled",
        now,
      ),
    ).toBe(false);
  });

  test("active_plan_canceled matches scheduled cancel with active paying access", () => {
    expect(
      matchesAccountStatusFilter(
        customer({
          hasApprovedPayment: true,
          scheduledCancel: true,
        }),
        "active_plan_canceled",
        now,
      ),
    ).toBe(true);
  });

  test("active_plan_pix matches only Mercado Pago Pix", () => {
    expect(
      matchesAccountStatusFilter(
        customer({
          hasApprovedPayment: true,
          lastPaymentProvider: "mercadopago",
        }),
        "active_plan_pix",
        now,
      ),
    ).toBe(true);
    expect(
      matchesAccountStatusFilter(
        customer({
          hasApprovedPayment: true,
          lastPaymentProvider: "vindi",
          lastPaymentMethod: "pix",
        }),
        "active_plan_pix",
        now,
      ),
    ).toBe(false);
    expect(
      matchesAccountStatusFilter(
        customer({
          hasApprovedPayment: true,
          lastPaymentProvider: "stripe",
        }),
        "active_plan_pix",
        now,
      ),
    ).toBe(false);
  });
});

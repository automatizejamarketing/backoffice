import { describe, expect, test } from "bun:test";
import {
  listCustomerBaseStatusUsers,
  matchesCustomerBaseCategory,
  summarizeCustomerBaseStatus,
} from "./customer-base-status";

describe("summarizeCustomerBaseStatus", () => {
  test("classifies paying, trial, churn and scheduled cancel customers", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");

    expect(
      summarizeCustomerBaseStatus(
        [
          {
            expirationDate: new Date("2026-08-06T12:00:00.000Z"),
            hasApprovedPayment: true,
            scheduledCancel: false,
            lastPaymentProvider: "stripe",
          },
          {
            expirationDate: new Date("2026-08-06T12:00:00.000Z"),
            hasApprovedPayment: false,
            scheduledCancel: false,
            lastPaymentProvider: null,
          },
          {
            expirationDate: new Date("2026-08-04T12:00:00.000Z"),
            hasApprovedPayment: true,
            scheduledCancel: false,
            lastPaymentProvider: "stripe",
          },
          {
            expirationDate: new Date("2026-08-04T12:00:00.000Z"),
            hasApprovedPayment: true,
            scheduledCancel: false,
            lastPaymentProvider: "mercadopago",
          },
          {
            expirationDate: new Date("2026-08-06T12:00:00.000Z"),
            hasApprovedPayment: true,
            scheduledCancel: true,
            lastPaymentProvider: "stripe",
          },
          {
            expirationDate: new Date("2026-08-04T12:00:00.000Z"),
            hasApprovedPayment: true,
            scheduledCancel: true,
            lastPaymentProvider: "stripe",
          },
        ],
        now,
      ),
    ).toEqual({
      activePaying: 2,
      trial: 1,
      churn: { total: 3, card: 2, pix: 1 },
      scheduledCancel: 1,
    });
  });

  test("does not count excluded internal emails as trial", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const internal = {
      email: "lucashaddad@infinitegrowth.com.br",
      expirationDate: new Date("2026-08-06T12:00:00.000Z"),
      hasApprovedPayment: false,
      scheduledCancel: false,
      lastPaymentProvider: null,
    };

    expect(summarizeCustomerBaseStatus([internal], now).trial).toBe(0);
    expect(matchesCustomerBaseCategory(internal, "trial", now)).toBe(false);
    expect(
      listCustomerBaseStatusUsers(
        [
          {
            ...internal,
            id: "1",
            name: "Lucas",
            phone: null,
            totalPaidCentavos: 0,
          },
        ],
        "trial",
        now,
      ),
    ).toEqual([]);
  });

  test("ignores scheduled cancel without approved payment", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");

    expect(
      summarizeCustomerBaseStatus(
        [
          {
            expirationDate: new Date("2026-08-06T12:00:00.000Z"),
            hasApprovedPayment: false,
            scheduledCancel: true,
            lastPaymentProvider: null,
          },
        ],
        now,
      ).scheduledCancel,
    ).toBe(0);
  });

  test("lists users for each category", () => {
    const now = new Date("2026-08-05T12:00:00.000Z");
    const customers = [
      {
        id: "1",
        email: "b@example.com",
        name: "Beta",
        phone: "11999998888",
        totalPaidCentavos: 9700,
        expirationDate: new Date("2026-08-06T12:00:00.000Z"),
        hasApprovedPayment: true,
        scheduledCancel: false,
        lastPaymentProvider: "stripe" as const,
      },
      {
        id: "2",
        email: "a@example.com",
        name: null,
        phone: null,
        totalPaidCentavos: 0,
        expirationDate: new Date("2026-08-06T12:00:00.000Z"),
        hasApprovedPayment: false,
        scheduledCancel: false,
        lastPaymentProvider: null,
      },
      {
        id: "3",
        email: "c@example.com",
        name: "Churn",
        phone: "21988887777",
        totalPaidCentavos: 9700,
        expirationDate: new Date("2026-08-04T12:00:00.000Z"),
        hasApprovedPayment: true,
        scheduledCancel: false,
        lastPaymentProvider: "mercadopago" as const,
      },
      {
        id: "4",
        email: "d@example.com",
        name: "Cancel",
        phone: "31977776666",
        totalPaidCentavos: 19400,
        expirationDate: new Date("2026-08-06T12:00:00.000Z"),
        hasApprovedPayment: true,
        scheduledCancel: true,
        lastPaymentProvider: "stripe" as const,
      },
    ];

    expect(
      listCustomerBaseStatusUsers(customers, "activePaying", now).map(
        (user) => user.email,
      ),
    ).toEqual(["b@example.com", "d@example.com"]);
    expect(
      listCustomerBaseStatusUsers(customers, "trial", now).map(
        (user) => user.email,
      ),
    ).toEqual(["a@example.com"]);
    expect(
      listCustomerBaseStatusUsers(customers, "churn", now).map(
        (user) => user.email,
      ),
    ).toEqual(["c@example.com"]);
    expect(
      listCustomerBaseStatusUsers(customers, "scheduledCancel", now).map(
        (user) => user.email,
      ),
    ).toEqual(["d@example.com"]);
    expect(
      matchesCustomerBaseCategory(customers[3], "scheduledCancel", now),
    ).toBe(true);
    expect(
      matchesCustomerBaseCategory(customers[1], "scheduledCancel", now),
    ).toBe(false);
  });
});

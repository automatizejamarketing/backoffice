import { describe, expect, test } from "bun:test";
import {
  getAccessBadgeProps,
  getAccessState,
  getAccountStatusBadge,
  getStripeAccessMismatch,
  getStripeBillingBadgeProps,
} from "./derive";

// 09/09/2026 12:00 em São Paulo.
const now = new Date("2026-09-09T15:00:00.000Z");

describe("getAccessState", () => {
  test("access is decided only by the expiration date", () => {
    expect(getAccessState("2026-09-05T20:54:40.352Z", now)).toEqual({
      kind: "expired",
      expirationDate: new Date("2026-09-05T20:54:40.352Z"),
      daysAgo: 4,
    });
    expect(getAccessState("2026-10-05T20:54:40.352Z", now)).toEqual({
      kind: "active",
      expirationDate: new Date("2026-10-05T20:54:40.352Z"),
      daysLeft: 26,
    });
  });

  test("missing or invalid dates mean no access", () => {
    expect(getAccessState(null, now)).toEqual({
      kind: "missing",
      expirationDate: null,
    });
    expect(getAccessState("not a date", now)).toEqual({
      kind: "missing",
      expirationDate: null,
    });
  });

  test("counts calendar days in São Paulo, not 24h blocks", () => {
    // 23:30 SP de hoje é "hoje", mesmo que já seja o dia seguinte em UTC.
    expect(getAccessState("2026-09-10T02:30:00.000Z", now)).toEqual({
      kind: "active",
      expirationDate: new Date("2026-09-10T02:30:00.000Z"),
      daysLeft: 0,
    });
  });
});

describe("getAccessBadgeProps", () => {
  test("expired access is destructive and says since when", () => {
    expect(getAccessBadgeProps("2026-09-05T20:54:40.352Z", now)).toEqual({
      tone: "destructive",
      label: "Vencido em 05/09/2026",
      hint: "há 4 dias",
    });
  });

  test("active access is success with the remaining days", () => {
    expect(getAccessBadgeProps("2026-10-05T20:54:40.352Z", now)).toEqual({
      tone: "success",
      label: "Ativo até 05/10/2026",
      hint: "em 26 dias",
    });
  });

  test("access about to expire turns into a warning", () => {
    expect(getAccessBadgeProps("2026-09-11T15:00:00.000Z", now)).toEqual({
      tone: "warning",
      label: "Ativo até 11/09/2026",
      hint: "em 2 dias",
    });
    expect(getAccessBadgeProps("2026-09-09T22:00:00.000Z", now).hint).toBe(
      "vence hoje",
    );
  });

  test("no date is neutral", () => {
    expect(getAccessBadgeProps(null, now)).toEqual({
      tone: "neutral",
      label: "Sem data de acesso",
    });
  });
});

describe("getStripeBillingBadgeProps", () => {
  test("active card billing shows the next charge", () => {
    expect(
      getStripeBillingBadgeProps({
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date("2026-10-05T12:00:00.000Z"),
      }),
    ).toEqual({
      tone: "success",
      label: "Ativa",
      hint: "próxima cobrança 05/10/2026",
    });
  });

  test("scheduled cancellation is a warning", () => {
    expect(
      getStripeBillingBadgeProps({
        status: "active",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date("2026-10-05T12:00:00.000Z"),
      }),
    ).toEqual({
      tone: "warning",
      label: "Ativa",
      hint: "cancela em 05/10/2026",
    });
  });

  test("past_due and unpaid are destructive", () => {
    expect(
      getStripeBillingBadgeProps({
        status: "past_due",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      }),
    ).toEqual({ tone: "destructive", label: "Pagamento atrasado" });
  });
});

describe("getStripeAccessMismatch", () => {
  test("flags Stripe still charging while access is expired", () => {
    expect(
      getStripeAccessMismatch(
        { provider: "stripe", status: "active" },
        "2026-09-05T20:54:40.352Z",
        now,
      ),
    ).toEqual({
      kind: "expired",
      statusLabel: "Ativa",
      expirationDate: new Date("2026-09-05T20:54:40.352Z"),
    });
  });

  test("flags a trial without an access date", () => {
    expect(
      getStripeAccessMismatch(
        { provider: "stripe", status: "trialing" },
        null,
        now,
      ),
    ).toEqual({ kind: "missing", statusLabel: "Em trial", expirationDate: null });
  });

  // Pix não tem "assinatura ativa": a linha fica `active` para sempre e isso
  // não é divergência com nada. O que vale é a data de expiração.
  test("never flags Pix or manual rows", () => {
    expect(
      getStripeAccessMismatch(
        { provider: "mercadopago", status: "active" },
        "2026-09-05T20:54:40.352Z",
        now,
      ),
    ).toBeNull();
    expect(
      getStripeAccessMismatch(
        { provider: "manual", status: "active" },
        null,
        now,
      ),
    ).toBeNull();
  });

  test("ignores Stripe rows that are not charging anymore", () => {
    expect(
      getStripeAccessMismatch(
        { provider: "stripe", status: "canceled" },
        "2026-09-05T20:54:40.352Z",
        now,
      ),
    ).toBeNull();
  });
});

describe("getAccountStatusBadge", () => {
  test("a Pix customer with expired access is simply expired", () => {
    expect(
      getAccountStatusBadge(
        "2026-09-05T20:54:40.352Z",
        {
          provider: "mercadopago",
          status: "active",
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date("2026-09-05T20:54:40.352Z"),
        },
        now,
      ),
    ).toEqual({
      tone: "destructive",
      label: "Vencido em 05/09/2026",
      hint: "há 4 dias",
    });
  });

  test("a Stripe customer keeps the billing status as a hint", () => {
    expect(
      getAccountStatusBadge(
        "2026-10-05T12:00:00.000Z",
        {
          provider: "stripe",
          status: "past_due",
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date("2026-10-05T12:00:00.000Z"),
        },
        now,
      ),
    ).toEqual({
      tone: "success",
      label: "Ativo até 05/10/2026",
      hint: "em 26 dias · Stripe: pagamento atrasado",
    });
  });
});

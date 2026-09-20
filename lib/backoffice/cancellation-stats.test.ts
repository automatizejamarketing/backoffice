import { describe, expect, test } from "bun:test";
import {
  RETENTION_REASON_KEYS,
  summarizeCancellationStats,
  type CancellationStatsAttempt,
  type CancellationStatsEvent,
} from "./cancellation-stats";

const asOf = new Date("2026-09-20T12:00:00.000Z");
const window = {
  gte: new Date("2026-08-01T00:00:00.000Z"),
  lt: new Date("2026-09-01T00:00:00.000Z"),
};

function attempt(
  id: string,
  overrides: Partial<CancellationStatsAttempt> = {},
): CancellationStatsAttempt {
  return {
    id,
    userId: `user-${id}`,
    startedAt: new Date("2026-08-10T12:00:00.000Z"),
    provider: "stripe",
    planType: "monthly_pro",
    reason: "price_too_high",
    offerType: "discount",
    outcome: null,
    accessValidUntil: new Date("2026-12-01T00:00:00.000Z"),
    renewalDueAt: null,
    ...overrides,
  };
}

function event(
  attemptId: string,
  eventType: CancellationStatsEvent["eventType"],
  occurredAt = "2026-08-11T12:00:00.000Z",
  offerType?: "discount" | "specialist",
): CancellationStatsEvent {
  return {
    attemptId,
    eventType,
    occurredAt: new Date(occurredAt),
    offerType,
  };
}

describe("cancellation stats aggregation", () => {
  test("counts canonical reasons from distinct attempts and keeps raw details out", () => {
    const attempts = [
      attempt("a1"),
      attempt("a2", { reason: "not_getting_results", reasonDetails: "private text" }),
      attempt("a3", { reason: "other", reasonDetails: "private text" }),
      attempt("a4", { reason: "raw free text" }),
    ];
    const summary = summarizeCancellationStats({ attempts, events: [], window, asOf });

    expect(summary.reasons.map((row) => row.reason)).toEqual(RETENTION_REASON_KEYS);
    expect(summary.reasons.map((row) => row.attempts)).toEqual([1, 1, 0, 0, 1]);
    expect(summary.reasons.every((row) => !("reasonDetails" in row))).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("private text");
  });

  test("filters by attempt start, provider, plan, and returns zero denominator rates", () => {
    const attempts = [
      attempt("in", { provider: "stripe", planType: "monthly_pro" }),
      attempt("other-provider", { provider: "mercadopago" }),
      attempt("other-plan", { planType: "annual_pro" }),
      attempt("outside", { startedAt: new Date("2026-09-01T00:00:00.000Z") }),
    ];
    const summary = summarizeCancellationStats({
      attempts,
      events: [],
      window,
      filters: { provider: "stripe", planType: "monthly_pro" },
      asOf,
    });

    expect(summary.completed).toEqual({ numerator: 0, denominator: 1, percent: 0 });
    expect(summary.offers.every((row) => row.accepted.percent === 0)).toBe(true);
    const empty = summarizeCancellationStats({
      attempts,
      events: [],
      window,
      filters: { provider: "manual" },
      asOf,
    });
    expect(empty.completed).toEqual({ numerator: 0, denominator: 0, percent: 0 });
  });

  test("deduplicates event retries and separates shown, accepted, completed, and scheduled", () => {
    const attempts = [
      attempt("discount", { outcome: "canceled" }),
      attempt("specialist", { offerType: "specialist", outcome: "scheduled" }),
    ];
    const events = [
      event("discount", "offer_shown", undefined, "discount"),
      event("discount", "offer_shown", undefined, "discount"),
      event("discount", "offer_accepted", undefined, "discount"),
      event("discount", "offer_accepted", undefined, "discount"),
      event("discount", "cancellation_completed"),
      event("discount", "cancellation_completed"),
      event("specialist", "offer_shown", undefined, "specialist"),
      event("specialist", "offer_accepted", undefined, "specialist"),
      event("specialist", "cancellation_scheduled"),
      event("specialist", "calendar_opened", undefined, "specialist"),
    ];
    const summary = summarizeCancellationStats({ attempts, events, window, asOf });

    expect(summary.offers).toEqual([
      { kind: "discount", shown: 1, accepted: { numerator: 1, denominator: 1, percent: 100 } },
      { kind: "specialist", shown: 1, accepted: { numerator: 1, denominator: 1, percent: 100 } },
    ]);
    expect(summary.completed).toEqual({ numerator: 1, denominator: 2, percent: 50 });
    expect(summary.scheduled).toEqual({ numerator: 1, denominator: 2, percent: 50 });
  });

  test("requires a matured accepted offer, valid access, and due renewal payment proof", () => {
    const attempts = [
      attempt("effective", {
        decisionAt: new Date("2026-08-20T12:00:00.000Z"),
        renewalDueAt: new Date("2026-09-10T12:00:00.000Z"),
        renewalPayment: { status: "succeeded", paidAt: new Date("2026-09-11T12:00:00.000Z") },
      }),
      attempt("pending", {
        decisionAt: new Date("2026-08-20T12:00:00.000Z"),
        renewalDueAt: new Date("2026-09-10T12:00:00.000Z"),
        renewalPayment: { status: "pending", paidAt: null },
      }),
      attempt("calendar-only", {
        offerType: "specialist",
        decisionAt: null,
        renewalPayment: null,
      }),
      attempt("pending-pix", {
        provider: "mercadopago",
        offerType: "discount",
        decisionAt: new Date("2026-08-20T12:00:00.000Z"),
        renewalDueAt: new Date("2026-10-01T12:00:00.000Z"),
        renewalPayment: { status: "pending", paidAt: null },
      }),
      attempt("immature", {
        decisionAt: new Date("2026-09-01T12:00:00.000Z"),
      }),
    ];
    const events = [
      event("effective", "offer_accepted", "2026-08-20T12:00:00.000Z", "discount"),
      event("pending", "offer_accepted", "2026-08-20T12:00:00.000Z", "discount"),
      event("calendar-only", "calendar_opened", "2026-08-20T12:00:00.000Z", "specialist"),
      event("calendar-only", "offer_accepted", "2026-08-20T12:00:00.000Z", "specialist"),
      event("pending-pix", "offer_accepted", "2026-08-20T12:00:00.000Z", "discount"),
      event("immature", "offer_accepted", "2026-09-01T12:00:00.000Z", "discount"),
    ];
    const summary = summarizeCancellationStats({ attempts, events, window, asOf });

    expect(summary.effectiveRetention30d).toEqual({ numerator: 1, denominator: 4, percent: 25 });
    expect(summary.immatureAcceptedAttempts).toBe(1);
  });

  test("does not count an accepted attempt after access expires", () => {
    const summary = summarizeCancellationStats({
      attempts: [
        attempt("expired", {
          decisionAt: new Date("2026-08-01T12:00:00.000Z"),
          accessValidUntil: new Date("2026-09-15T00:00:00.000Z"),
        }),
      ],
      events: [event("expired", "offer_accepted", "2026-08-01T12:00:00.000Z", "discount")],
      window,
      asOf,
    });
    expect(summary.effectiveRetention30d).toEqual({ numerator: 0, denominator: 1, percent: 0 });
  });

  test("ignores an acceptance belonging to an offer replaced after a reason change", () => {
    const summary = summarizeCancellationStats({
      attempts: [attempt("changed", { offerType: "specialist" })],
      events: [
        event("changed", "offer_accepted", "2026-08-01T12:00:00.000Z", "discount"),
        event("changed", "offer_shown", "2026-08-02T12:00:00.000Z", "specialist"),
      ],
      window,
      asOf,
    });

    expect(summary.offers).toEqual([
      { kind: "discount", shown: 0, accepted: { numerator: 0, denominator: 0, percent: 0 } },
      { kind: "specialist", shown: 1, accepted: { numerator: 0, denominator: 1, percent: 0 } },
    ]);
    expect(summary.effectiveRetention30d).toEqual({ numerator: 0, denominator: 0, percent: 0 });
  });

  test("uses a reserved discount benefit only as a legacy acceptance anchor", () => {
    const summary = summarizeCancellationStats({
      attempts: [
        attempt("legacy", {
          acceptedAt: new Date("2026-08-01T12:00:00.000Z"),
          renewalDueAt: new Date("2026-08-10T12:00:00.000Z"),
          renewalPayment: { status: "pending", paidAt: null },
        }),
      ],
      events: [],
      window,
      asOf,
    });

    expect(summary.effectiveRetention30d).toEqual({ numerator: 0, denominator: 1, percent: 0 });
    expect(summary.immatureAcceptedAttempts).toBe(0);
  });

  test("matures at exactly 30 days and not one millisecond before", () => {
    const acceptedAt = new Date("2026-08-01T12:00:00.000Z");
    const base = {
      attempts: [attempt("boundary")],
      events: [event("boundary", "offer_accepted", acceptedAt.toISOString(), "discount")],
      window,
    };
    const before = summarizeCancellationStats({
      ...base,
      asOf: new Date("2026-08-31T11:59:59.999Z"),
    });
    const exact = summarizeCancellationStats({
      ...base,
      asOf: new Date("2026-08-31T12:00:00.000Z"),
    });

    expect(before.effectiveRetention30d.denominator).toBe(0);
    expect(before.immatureAcceptedAttempts).toBe(1);
    expect(exact.effectiveRetention30d.denominator).toBe(1);
    expect(exact.immatureAcceptedAttempts).toBe(0);
  });
});

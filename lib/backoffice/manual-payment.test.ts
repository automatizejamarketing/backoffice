import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseManualPaymentDate,
  quoteManualPayment,
  saoPauloDateKey,
} from "./manual-payment";

describe("manual payment quote", () => {
  it("extends monthly_starter from a null expiration at noon Sao Paulo", () => {
    const paidAt = parseManualPaymentDate("2026-08-19");

    assert.equal(paidAt.toISOString(), "2026-08-19T15:00:00.000Z");
    assert.equal(saoPauloDateKey(paidAt), "2026-08-19");

    const quote = quoteManualPayment({
      planType: "monthly_starter",
      paidAt,
      currentExpiration: null,
      now: paidAt,
    });

    assert.equal(quote.ok, true);
    if (!quote.ok) return;
    assert.equal(saoPauloDateKey(quote.newExpiration), "2026-09-19");
    assert.equal(quote.newExpiration.toISOString(), "2026-09-19T15:00:00.000Z");
  });

  it("recharges after a future database expiration", () => {
    const quote = quoteManualPayment({
      planType: "monthly_starter",
      paidAt: new Date("2026-08-03T12:00:00.000Z"),
      currentExpiration: new Date("2026-09-10T12:00:00.000Z"),
      now: new Date("2026-08-03T12:00:00.000Z"),
    });

    assert.equal(quote.ok, true);
    if (!quote.ok) return;
    assert.equal(quote.newExpiration.toISOString(), "2026-10-10T12:00:00.000Z");
  });

  it("rejects a payment date after today in America/Sao_Paulo", () => {
    const now = parseManualPaymentDate("2026-08-19");
    const quote = quoteManualPayment({
      planType: "monthly_starter",
      paidAt: parseManualPaymentDate("2026-08-20"),
      currentExpiration: null,
      now,
    });

    assert.deepEqual(quote, {
      ok: false,
      error: "payment_date_in_future",
    });
  });

  it("grants 250 credits for monthly and 750 for quarterly_pro", () => {
    const paidAt = parseManualPaymentDate("2026-08-19");

    const monthly = quoteManualPayment({
      planType: "monthly_starter",
      paidAt,
      currentExpiration: null,
      now: paidAt,
    });
    const quarterly = quoteManualPayment({
      planType: "quarterly_pro",
      paidAt,
      currentExpiration: null,
      now: paidAt,
    });

    assert.equal(monthly.ok, true);
    assert.equal(quarterly.ok, true);
    if (!monthly.ok || !quarterly.ok) return;
    assert.equal(monthly.credits, 250);
    assert.equal(quarterly.credits, 750);
  });

  it("uses the monthly_starter commitment amount of 29700 centavos", () => {
    const paidAt = parseManualPaymentDate("2026-08-19");
    const quote = quoteManualPayment({
      planType: "monthly_starter",
      paidAt,
      currentExpiration: null,
      now: paidAt,
    });

    assert.equal(quote.ok, true);
    if (!quote.ok) return;
    assert.equal(quote.amountCentavos, 29700);
  });
});

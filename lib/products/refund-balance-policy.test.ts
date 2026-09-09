import { describe, expect, test } from "bun:test";
import {
  getRefundBalanceNextAction,
  getRefundBalanceSalesPause,
  isInsufficientRefundBalance,
  resolveRefundBalanceResponsibility,
} from "./refund-balance-policy";

describe("refund balance regularization", () => {
  const firstFailure = new Date("2026-09-09T10:00:00.000Z");

  test("keeps the original 24-hour deadline and never pauses for platform balance", () => {
    expect(getRefundBalanceSalesPause({ responsible: "expert", firstFailedAt: firstFailure, status: "pending", now: new Date("2026-09-10T10:00:00.000Z") }).paused).toBe(true);
    expect(getRefundBalanceSalesPause({ responsible: "automatize", firstFailedAt: firstFailure, status: "pending", now: new Date("2026-09-11T10:00:00.000Z") }).paused).toBe(false);
  });

  test("uses the frozen receiver attribution and explicit provider code", () => {
    expect(resolveRefundBalanceResponsibility({ expertId: "expert-1", receiverAccountId: "mp-old" })).toEqual({ kind: "expert", expertId: "expert-1" });
    expect(resolveRefundBalanceResponsibility({ expertId: null, receiverAccountId: "mp-platform" })).toEqual({ kind: "automatize" });
    expect(isInsufficientRefundBalance({ status: 428, responseBody: { error: "insufficient_money_for_refund" } })).toBe(true);
    expect(isInsufficientRefundBalance({ status: 422, responseBody: { error: "insufficient_money_for_refund" } })).toBe(false);
  });

  test("does not turn a retry schedule into an automatic release", () => {
    const dueAt = new Date("2026-09-10T10:00:00.000Z");
    expect(getRefundBalanceNextAction({ responsible: "expert", status: "pending", now: new Date("2026-09-10T10:01:00.000Z"), regularizationDueAt: dueAt, nextRetryAt: new Date("2026-09-10T10:05:00.000Z") })).toBe("retry_scheduled");
    expect(getRefundBalanceNextAction({ responsible: "expert", status: "pending", now: new Date("2026-09-10T10:06:00.000Z"), regularizationDueAt: dueAt, nextRetryAt: new Date("2026-09-10T10:05:00.000Z") })).toBe("pause_new_sales");
    expect(getRefundBalanceNextAction({ responsible: "expert", status: "resolved", now: new Date("2026-09-10T10:06:00.000Z"), regularizationDueAt: dueAt })).toBe("resolved");
  });
});

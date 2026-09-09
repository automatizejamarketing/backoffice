export const REFUND_BALANCE_REGULARIZATION_MS = 24 * 60 * 60 * 1000;
export const REFUND_BALANCE_RETRY_DELAY_MS = 5 * 60 * 1000;

export type RefundBalanceResponsible = "expert" | "automatize" | "unknown";

export type RefundBalanceResolution =
  | { kind: "expert"; expertId: string }
  | { kind: "automatize" }
  | { kind: "unknown" };

/** The receiver snapshot, not the current active account, owns the debt. */
export function resolveRefundBalanceResponsibility(input: {
  expertId: string | null | undefined;
  receiverAccountId: string | null | undefined;
}): RefundBalanceResolution {
  if (input.expertId && input.receiverAccountId) {
    return { kind: "expert", expertId: input.expertId };
  }
  if (!input.expertId) {
    return { kind: "automatize" };
  }
  return { kind: "unknown" };
}

/** Mercado Pago's documented refund error is 428 with this explicit code. */
export function isInsufficientRefundBalance(input: {
  status?: number | null;
  responseBody?: unknown;
  message?: string | null;
}) {
  if (input.status !== 428) return false;
  const body = `${JSON.stringify(input.responseBody ?? null)} ${input.message ?? ""}`.toLowerCase();
  return body.includes("insufficient_money_for_refund") ||
    (body.includes("insufficient") && (body.includes("balance") || body.includes("fund")));
}

/** A retry is evidence of work, never a new 24-hour allowance. */
export function getRefundBalanceSalesPause(input: {
  responsible: RefundBalanceResponsible;
  firstFailedAt: Date;
  status: "pending" | "resolved";
  now: Date;
}) {
  const dueAt = new Date(input.firstFailedAt.getTime() + REFUND_BALANCE_REGULARIZATION_MS);
  return {
    dueAt,
    paused:
      input.status === "pending" &&
      input.responsible === "expert" &&
      input.now.getTime() >= dueAt.getTime(),
  };
}

export function getRefundBalanceNextAction(input: {
  responsible: RefundBalanceResponsible;
  status: "pending" | "resolved";
  now: Date;
  regularizationDueAt: Date;
  nextRetryAt?: Date | null;
}) {
  if (input.status === "resolved") return "resolved" as const;
  if (input.nextRetryAt && input.nextRetryAt > input.now) return "retry_scheduled" as const;
  if (input.responsible === "expert" && input.now >= input.regularizationDueAt) return "pause_new_sales" as const;
  return "retry_now" as const;
}

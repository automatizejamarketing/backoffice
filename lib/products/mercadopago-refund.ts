/** The decision boundary for an operator-issued whole-checkout refund. */
export type ProductRefundDecision =
  | { kind: "issue"; amountCentavos: number }
  | { kind: "reconcile_full"; amountCentavos: number }
  | { kind: "block_external_partial"; amountCentavos: number }
  | { kind: "recover_uncertain" }
  | { kind: "retry" }
  | { kind: "reject"; reason: string };

export function decideProductIntegralRefund(input: {
  orderStatuses: string[];
  grossAmountCentavos: number | null;
  refundedAmountCentavos?: number | null;
  operationStatus?: "issuing" | "confirmed" | "failed" | "external_partial";
}): ProductRefundDecision {
  const gross = input.grossAmountCentavos;
  if (!Number.isSafeInteger(gross) || !gross || gross <= 0) {
    return { kind: "reject", reason: "payment_amount_unknown" };
  }
  const refunded = Math.max(0, input.refundedAmountCentavos ?? 0);
  if (refunded >= gross) return { kind: "reconcile_full", amountCentavos: refunded };
  if (!input.orderStatuses.length || input.orderStatuses.some((status) => status !== "approved")) {
    return { kind: "reject", reason: "checkout_not_approved" };
  }
  if (refunded > 0) return { kind: "block_external_partial", amountCentavos: refunded };
  if (input.operationStatus === "issuing") return { kind: "recover_uncertain" };
  if (input.operationStatus === "failed") return { kind: "retry" };
  if (input.operationStatus === "confirmed") return { kind: "reconcile_full", amountCentavos: gross };
  return { kind: "issue", amountCentavos: gross };
}

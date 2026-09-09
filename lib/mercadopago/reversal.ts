import type { MercadoPagoPayment } from "./fetch-payment";

function centavos(value: number | undefined): number {
  return Number.isFinite(value) ? Math.round((value ?? 0) * 100) : 0;
}

/** Returns the cumulative provider-observed refund, without inferring it from
 * an HTTP status or from an arbitrary item price. */
export function readMercadoPagoRefundedAmountCentavos(
  payment: Pick<MercadoPagoPayment, "status" | "transaction_amount" | "transaction_amount_refunded" | "refunds">,
): number {
  const cumulative = centavos(payment.transaction_amount_refunded);
  if (cumulative > 0) return cumulative;
  const fromRefunds = (payment.refunds ?? []).reduce(
    (total, refund) => total + centavos(refund.amount),
    0,
  );
  if (fromRefunds > 0) return fromRefunds;
  if (payment.status === "refunded" || payment.status === "charged_back") {
    return centavos(payment.transaction_amount);
  }
  return 0;
}

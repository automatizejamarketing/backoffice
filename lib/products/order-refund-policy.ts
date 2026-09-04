export type ProductOrderRefundDecision =
  | { ok: true; path: "mercadopago"; paymentId: string }
  | { ok: true; path: "manual" }
  | {
      ok: false;
      reason:
        | "not_approved"
        | "already_refunded"
        | "mercadopago_payment_missing";
    };

export type ProductOrderRefundInput = {
  status: string;
  provider: string | null;
  providerPaymentId: string | null;
};

/** Elegibilidade de reembolso de pedido de produto.
 *
 * Mercado Pago: estorno real no gateway. Demais provedores: registro
 * manual (Pix ao cliente fora do sistema).
 *
 * Ticket 16 — ponto de extensão: quando o pagamento for Stripe numa
 * **Conta Stripe do Expert**, devolver um path `connected_account` e
 * reembolsar na conta conectada (`refund_application_fee`). Enquanto
 * essa conta não existir neste backoffice, Stripe segue o registro
 * manual. */
export function decideProductOrderRefund(
  input: ProductOrderRefundInput,
): ProductOrderRefundDecision {
  if (input.status === "refunded") {
    return { ok: false, reason: "already_refunded" };
  }
  if (input.status !== "approved") {
    return { ok: false, reason: "not_approved" };
  }

  if (input.provider === "mercadopago") {
    if (!input.providerPaymentId) {
      return { ok: false, reason: "mercadopago_payment_missing" };
    }
    return {
      ok: true,
      path: "mercadopago",
      paymentId: input.providerPaymentId,
    };
  }

  return { ok: true, path: "manual" };
}

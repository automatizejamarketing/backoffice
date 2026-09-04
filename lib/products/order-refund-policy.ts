export type ProductOrderRefundDecision =
  | { ok: true; path: "mercadopago"; paymentId: string }
  | {
      ok: true;
      path: "connected_account";
      stripeAccountId: string;
      paymentIntentId: string;
    }
  | { ok: true; path: "manual" }
  | {
      ok: false;
      reason:
        | "not_approved"
        | "already_refunded"
        | "mercadopago_payment_missing"
        | "stripe_payment_missing";
    };

export type ProductOrderRefundInput = {
  status: string;
  provider: string | null;
  providerPaymentId: string | null;
  stripeAccountId?: string | null;
};

/** Elegibilidade de reembolso de pedido de produto.
 *
 * Mercado Pago: estorno real no gateway. Stripe com **Conta Stripe do Expert**
 * (**Cobrança Direta**): reembolso na conta conectada com
 * `refund_application_fee` proporcional. Stripe sem conta conectada e demais
 * provedores: registro manual. */
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

  if (input.provider === "stripe" && input.stripeAccountId) {
    if (!input.providerPaymentId) {
      return { ok: false, reason: "stripe_payment_missing" };
    }
    return {
      ok: true,
      path: "connected_account",
      stripeAccountId: input.stripeAccountId,
      paymentIntentId: input.providerPaymentId,
    };
  }

  return { ok: true, path: "manual" };
}

import {
  decideProductOrderRefund,
  type ProductOrderRefundDecision,
} from "./order-refund-policy";

export type RefundableProductOrder = {
  id: string;
  status: string;
  provider: string | null;
  providerPaymentId: string | null;
};

export type ProductOrderRefundStore = {
  recordRefund(
    orderId: string,
    eventSuffix: string,
  ): Promise<{ id: string; status: string }>;
};

export type MercadoPagoProductRefundClient = {
  refundPayment(paymentId: string, idempotencyKey: string): Promise<void>;
};

export type RefundProductOrderResult =
  | {
      ok: true;
      path: "mercadopago" | "manual";
      order: RefundableProductOrder;
    }
  | Extract<ProductOrderRefundDecision, { ok: false }>
  | { ok: false; reason: "gateway_rejected"; message: string };

export async function refundProductOrder(input: {
  order: RefundableProductOrder;
  mercadoPago: MercadoPagoProductRefundClient;
  store: ProductOrderRefundStore;
}): Promise<RefundProductOrderResult> {
  const decision = decideProductOrderRefund(input.order);
  if (!decision.ok) return decision;

  if (decision.path === "mercadopago") {
    try {
      await input.mercadoPago.refundPayment(
        decision.paymentId,
        `product-order-refund:${input.order.id}`,
      );
    } catch (error) {
      return {
        ok: false,
        reason: "gateway_rejected",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const recorded = await input.store.recordRefund(
      input.order.id,
      decision.paymentId,
    );
    return {
      ok: true,
      path: "mercadopago",
      order: { ...input.order, status: recorded.status },
    };
  }

  const recorded = await input.store.recordRefund(input.order.id, "manual");
  return {
    ok: true,
    path: "manual",
    order: { ...input.order, status: recorded.status },
  };
}

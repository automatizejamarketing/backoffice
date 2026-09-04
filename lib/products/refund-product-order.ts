import {
  decideProductOrderRefund,
  type ProductOrderRefundDecision,
} from "./order-refund-policy";
import { calculateProportionalRefundApplicationFee } from "./connect-refund-fee";
import type { StripeConnectRefundClient } from "@/lib/stripe/connect/port";

export type RefundableProductOrder = {
  id: string;
  status: string;
  provider: string | null;
  providerPaymentId: string | null;
  stripeAccountId?: string | null;
  grossAmountCentavos?: number | null;
  priceCentavos?: number;
  automatizeCoproductionRevenueCentavos?: number | null;
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
      path: "mercadopago" | "manual" | "connected_account";
      order: RefundableProductOrder;
    }
  | Extract<ProductOrderRefundDecision, { ok: false }>
  | { ok: false; reason: "gateway_rejected"; message: string };

export async function refundProductOrder(input: {
  order: RefundableProductOrder;
  mercadoPago: MercadoPagoProductRefundClient;
  stripeConnect: StripeConnectRefundClient;
  store: ProductOrderRefundStore;
  refundAmountCentavos?: number;
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

  if (decision.path === "connected_account") {
    const grossAmountCentavos =
      input.order.grossAmountCentavos ??
      input.order.priceCentavos ??
      input.refundAmountCentavos ??
      0;
    const refundAmountCentavos =
      input.refundAmountCentavos ?? grossAmountCentavos;
    const applicationFeeCentavos =
      input.order.automatizeCoproductionRevenueCentavos ?? 0;
    const proportionalFee = calculateProportionalRefundApplicationFee({
      refundAmountCentavos,
      grossAmountCentavos,
      applicationFeeCentavos,
    });

    try {
      const refund = await input.stripeConnect.refunds.create(
        {
          payment_intent: decision.paymentIntentId,
          ...(refundAmountCentavos < grossAmountCentavos
            ? { amount: refundAmountCentavos }
            : {}),
          ...(proportionalFee > 0 ? { refund_application_fee: true } : {}),
        },
        { stripeAccount: decision.stripeAccountId },
      );
      const recorded = await input.store.recordRefund(
        input.order.id,
        refund.id,
      );
      return {
        ok: true,
        path: "connected_account",
        order: { ...input.order, status: recorded.status },
      };
    } catch (error) {
      return {
        ok: false,
        reason: "gateway_rejected",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const recorded = await input.store.recordRefund(input.order.id, "manual");
  return {
    ok: true,
    path: "manual",
    order: { ...input.order, status: recorded.status },
  };
}

import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  applyFullProductRefund,
  listProductOrders,
} from "@/lib/db/product-queries";
import { db } from "@/lib/db";
import { backofficeAuditLog } from "@/lib/db/schema";
import { refundMercadoPagoProductPayment } from "@/lib/mercadopago/product-refunds";
import { createStripeConnectRefundClient } from "@/lib/stripe/connect/client";
import { refundProductOrder } from "@/lib/products/refund-product-order";

const REFUND_REASON_COPY = {
  not_approved: "Pedido não está aprovado",
  already_refunded: null,
  mercadopago_payment_missing:
    "Pagamento Mercado Pago sem identificador — não é possível estornar no gateway.",
  stripe_payment_missing:
    "Pagamento Stripe sem identificador — não é possível reembolsar na conta conectada.",
} as const;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const order = (await listProductOrders()).find((row) => row.id === id);
  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  const result = await refundProductOrder({
    order: {
      id: order.id,
      status: order.status,
      provider: order.provider,
      providerPaymentId: order.providerPaymentId,
      stripeAccountId: order.stripeAccountId,
      grossAmountCentavos: order.grossAmountCentavos,
      priceCentavos: order.priceCentavos,
      automatizeCoproductionRevenueCentavos:
        order.automatizeCoproductionRevenueCentavos,
    },
    mercadoPago: {
      refundPayment: async (paymentId, idempotencyKey) => {
        await refundMercadoPagoProductPayment(paymentId, idempotencyKey);
      },
    },
    stripeConnect: createStripeConnectRefundClient(),
    store: {
      recordRefund: (orderId, eventSuffix) =>
        applyFullProductRefund(orderId, eventSuffix),
    },
  });

  if (!result.ok) {
    if (result.reason === "already_refunded") {
      return NextResponse.json(order);
    }
    if (result.reason === "gateway_rejected") {
      return NextResponse.json({ error: result.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: REFUND_REASON_COPY[result.reason] },
      { status: 422 },
    );
  }

  if (order.buyerUserId) {
    await db.insert(backofficeAuditLog).values({
      adminEmail: authz.actor.email,
      targetUserId: order.buyerUserId,
      action: "refund_product_order",
      fieldName: "product_order_status",
      oldValue: order.status,
      newValue: "refunded",
      note: `Pedido ${order.id} · ${result.path} · ${order.priceCentavos} centavos`,
    });
  }

  return NextResponse.json(result.order);
}

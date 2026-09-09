import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  applyFullProductRefund,
  listProductOrders,
} from "@/lib/db/product-queries";
import { db } from "@/lib/db";
import { backofficeAuditLog } from "@/lib/db/schema";
import { createStripeConnectRefundClient } from "@/lib/stripe/connect/client";
import { refundProductOrder } from "@/lib/products/refund-product-order";
import { executeProductIntegralRefund } from "@/lib/products/mercadopago-refund-service";

const REFUND_REASON_COPY = {
  not_approved: "Pedido não está aprovado",
  already_refunded: null,
  mercadopago_payment_missing:
    "Pagamento Mercado Pago sem identificador — não é possível estornar no gateway.",
  stripe_payment_missing:
    "Pagamento Stripe sem identificador — não é possível reembolsar na conta conectada.",
} as const;
const requestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const parsedBody = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Informe um motivo entre 1 e 500 caracteres." },
      { status: 400 },
    );
  }
  const reason = parsedBody.data.reason;
  const { id } = await params;
  const order = (await listProductOrders()).find((row) => row.id === id);
  if (!order) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  if ((order.checkoutProvider ?? order.provider) === "mercadopago") {
    try {
      const result = await executeProductIntegralRefund({
        orderId: id,
        operatorEmail: authz.actor.email,
        reason,
      });
      if (order.buyerUserId) {
        await db.insert(backofficeAuditLog).values({
          adminEmail: authz.actor.email,
          targetUserId: order.buyerUserId,
          action: "refund_product_checkout",
          fieldName: "product_checkout_refund",
          oldValue: order.status,
          newValue: result.status,
          note: `Cobrança ${result.rootOrderId} · itens ${result.orderIds.join(",")} · ${result.amountCentavos} centavos · motivo: ${reason}`,
        });
      }
      return NextResponse.json(
        result,
        { status: result.status === "processing" ? 202 : result.status === "external_partial" ? 409 : 200 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "refund_failed";
      return NextResponse.json(
        { error: REFUND_REASON_COPY[message as keyof typeof REFUND_REASON_COPY] ?? message },
        { status: message === "product_order_not_found" ? 404 : 422 },
      );
    }
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
    mercadoPago: { refundPayment: async () => undefined },
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
      note: `Pedido ${order.id} · ${result.path} · ${order.priceCentavos} centavos · motivo: ${reason}`,
    });
  }

  return NextResponse.json(result.order);
}

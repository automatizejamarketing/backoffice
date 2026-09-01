import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  applyFullProductRefund,
  listProductOrders,
} from "@/lib/db/product-queries";
import { db } from "@/lib/db";
import { backofficeAuditLog } from "@/lib/db/schema";
import { VindiApiError } from "@/lib/vindi/client";
import { createPrivateVindiClient } from "@/lib/vindi/private";
import { refundVindiCharge, VINDI_REFUND_ACTION } from "@/lib/vindi/refund";

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
  if (order.status === "refunded") return NextResponse.json(order);
  try {
    if (order.provider === "vindi" && order.vindiChargeId) {
      // Estorno real pela API da Vindi (total, requer saldo na conta). O
      // webhook charge_refunded do frontend re-aplica a reversão do pedido e
      // encontra a linha já reembolsada — no-op.
      try {
        await refundVindiCharge(createPrivateVindiClient(), order.vindiChargeId);
      } catch (error) {
        if (error instanceof VindiApiError) {
          return NextResponse.json(
            { error: `A Vindi recusou o estorno: ${error.message}` },
            { status: 422 },
          );
        }
        throw error;
      }
      const updated = await applyFullProductRefund(
        order.id,
        order.vindiChargeId,
      );
      if (order.buyerUserId) {
        await db.insert(backofficeAuditLog).values({
          adminEmail: authz.actor.email,
          targetUserId: order.buyerUserId,
          action: VINDI_REFUND_ACTION,
          fieldName: "product_order_status",
          oldValue: order.status,
          newValue: "refunded",
          note: `Pedido ${order.id} · Vindi charge ${order.vindiChargeId} · ${order.priceCentavos} centavos`,
        });
      }
      return NextResponse.json(updated);
    }

    // Registro-only: a devolução ao cliente é feita manualmente via Pix, fora
    // do sistema. Nenhuma chamada de reembolso ao provedor — o mesmo caminho
    // vale para pagamentos Mercado Pago e Stripe.
    return NextResponse.json(
      await applyFullProductRefund(order.id, "manual-pix"),
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}

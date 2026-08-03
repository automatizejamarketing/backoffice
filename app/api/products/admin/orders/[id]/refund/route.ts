import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  applyFullProductRefund,
  listProductOrders,
} from "@/lib/db/product-queries";
import { refundMercadoPagoProductPayment } from "@/lib/mercadopago/product-refunds";

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
    let refundReference = "free";
    if (order.providerPaymentId) {
      const refund = await refundMercadoPagoProductPayment(
        order.providerPaymentId,
        `product-refund-${order.id}`,
      );
      refundReference = String(refund.id ?? order.providerPaymentId);
    }
    return NextResponse.json(
      await applyFullProductRefund(order.id, refundReference),
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}


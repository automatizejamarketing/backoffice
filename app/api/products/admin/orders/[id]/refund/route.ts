import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  applyFullProductRefund,
  listProductOrders,
} from "@/lib/db/product-queries";

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


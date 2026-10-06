import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listHeldProductPayments } from "@/lib/db/product-queries";

export type HeldProductPaymentView = {
  providerPaymentId: string;
  rawStatus: string;
  heldSince: string;
  amountCentavos: number;
  paymentMethodId: string | null;
  installments: number | null;
  orderId: string;
  productTitle: string;
  buyerName: string;
  buyerEmail: string;
  expertName: string | null;
};

/** Leitura pura: listar não consulta o provedor nem libera nada. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const rows = await listHeldProductPayments();
  const view: HeldProductPaymentView[] = rows.map((row) => ({
    providerPaymentId: row.providerPaymentId ?? "",
    rawStatus: row.rawStatus ?? "",
    heldSince: row.heldSince.toISOString(),
    // O bruto da cobrança inclui os order bumps; sem ele, vale o preço do pedido.
    amountCentavos: row.grossAmountCentavos ?? row.priceCentavos,
    paymentMethodId: row.paymentMethodId,
    installments: row.installments,
    orderId: row.orderId,
    productTitle: row.productTitle,
    buyerName: row.buyerName,
    buyerEmail: row.buyerEmail,
    expertName: row.expertName,
  }));
  return NextResponse.json(view);
}

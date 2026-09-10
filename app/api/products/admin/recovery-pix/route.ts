import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listRecoveryPixOrders } from "@/lib/db/product-queries";
import { resolveRecoveryPixState } from "@/lib/products/recovery-pix-policy";

export type RecoveryPixOrderView = {
  id: string;
  productId: string;
  productTitle: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  priceCentavos: number;
  currency: string;
  createdAt: string;
  /** "expired" = precisa de ação; "active" = já abordado, código no ar. */
  state: "expired" | "active";
  generatedAt: string | null;
  expiresAt: string | null;
  adminEmail: string | null;
  attempts: number;
};

/**
 * Fila do vendedor. O estado é resolvido aqui, no servidor, para a tela não
 * reimplementar a regra de "ainda vale?" — que depende do relógio e é a mesma
 * que decide se a geração cria ou reaproveita a cobrança.
 */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const now = new Date();
  const rows = await listRecoveryPixOrders();

  const view: RecoveryPixOrderView[] = rows.flatMap((row) => {
    const state = resolveRecoveryPixState(
      {
        orderStatus: row.status,
        paymentStatus: row.paymentStatus,
        paymentRawStatus: row.paymentRawStatus,
        paymentMethodId: row.paymentMethodId,
        attribution: row.attribution,
      },
      now,
    );

    // `settled`/`not_applicable` só aparecem numa corrida: o cliente pagou entre
    // a consulta e agora, ou o carimbo venceu no meio. Fora da fila.
    if (state.kind !== "expired" && state.kind !== "active") return [];

    return [
      {
        id: row.id,
        productId: row.productId,
        productTitle: row.productTitle,
        buyerName: row.buyerName,
        buyerEmail: row.buyerEmail,
        buyerPhone: row.buyerPhone,
        priceCentavos: row.priceCentavos,
        currency: row.currency,
        createdAt: row.createdAt.toISOString(),
        state: state.kind,
        generatedAt:
          state.kind === "active" ? state.stamp.generatedAt.toISOString() : null,
        expiresAt:
          state.kind === "active" ? state.stamp.expiresAt.toISOString() : null,
        adminEmail: state.kind === "active" ? state.stamp.adminEmail : null,
        attempts: state.kind === "active" ? state.stamp.attempts : 0,
      },
    ];
  });

  return NextResponse.json(view);
}

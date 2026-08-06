import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listNegativeReferralBalances } from "@/lib/referral/write-off-queries";

/**
 * Quem está com saldo negativo — a fila da baixa (ticket 12).
 *
 * Saldo negativo é estado ESPERADO no programa: o prazo de chargeback é de 90 a
 * 180 dias contra uma carência de 30. Esta lista existe para que o operador
 * saiba em quem olhar sem depender de o afiliado reclamar.
 */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const balances = await listNegativeReferralBalances();
    return NextResponse.json({ balances });
  } catch (error) {
    console.error("[referral] failed to list negative balances", error);
    return NextResponse.json(
      { error: "Erro ao carregar os saldos negativos" },
      { status: 500 },
    );
  }
}

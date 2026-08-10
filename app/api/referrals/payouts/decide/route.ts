import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  decideReferralPayout,
  REFERRAL_PAYOUT_DECISIONS,
  type ReferralPayoutDecision,
} from "@/lib/referral/payout-queries";
import { ReferralOperationError } from "@/lib/referral/queries";

/**
 * Aprovar, marcar como pago e negar são a MESMA rota: as três são a mesma
 * decisão administrativa sobre o mesmo pedido, e separá-las em três caminhos
 * faria a tabela de transições ser conferida em três lugares.
 *
 * O autor da decisão vem da sessão do backoffice, nunca do corpo.
 */
export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as {
      payoutId?: unknown;
      status?: unknown;
      proofUrl?: unknown;
      reason?: unknown;
    };

    const payoutId = typeof body.payoutId === "string" ? body.payoutId : null;
    if (!payoutId) {
      return NextResponse.json(
        { error: "Informe o pedido de saque" },
        { status: 400 },
      );
    }

    const status = REFERRAL_PAYOUT_DECISIONS.includes(
      body.status as ReferralPayoutDecision,
    )
      ? (body.status as ReferralPayoutDecision)
      : null;
    if (!status) {
      return NextResponse.json(
        { error: "Decisão inválida — use aprovar, pagar ou negar" },
        { status: 400 },
      );
    }

    const payout = await decideReferralPayout({
      payoutId,
      status,
      proofUrl: typeof body.proofUrl === "string" ? body.proofUrl : null,
      reason: typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : null,
      adminEmail: authz.actor.email,
    });

    return NextResponse.json({
      payoutId: payout.id,
      status: payout.status,
      paidAt: payout.paidAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[referral] failed to decide payout request", error);
    return NextResponse.json(
      { error: "Erro ao processar o saque" },
      { status: 500 },
    );
  }
}

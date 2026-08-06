import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { parseAgreementTerms } from "@/lib/referral/agreement";
import {
  approveReferralAffiliate,
  ReferralOperationError,
} from "@/lib/referral/queries";

/**
 * Aprovar um pedido e recrutar alguém que não pediu são a MESMA rota: a única
 * diferença é o pedido chegar com `affiliateId` (fila) ou com `userId`
 * (recrutamento). Em ambos os casos o Acordo de Comissão é criado na mesma
 * transação da aprovação.
 */
export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as {
      affiliateId?: unknown;
      userId?: unknown;
      format?: unknown;
      percentageBps?: unknown;
      fixedAmountCentavos?: unknown;
      duration?: unknown;
      durationCycles?: unknown;
    };

    const affiliateId =
      typeof body.affiliateId === "string" ? body.affiliateId : null;
    const userId = typeof body.userId === "string" ? body.userId : null;
    if (!affiliateId && !userId) {
      return NextResponse.json(
        { error: "Informe o afiliado ou o usuário a ser aprovado" },
        { status: 400 },
      );
    }

    const parsed = parseAgreementTerms(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await approveReferralAffiliate({
      affiliateId,
      userId,
      terms: parsed.terms,
      adminEmail: authz.actor.email,
    });

    return NextResponse.json({
      affiliateId: result.affiliate.id,
      code: result.affiliate.code,
      agreementId: result.agreement.id,
      recruited: result.recruited,
    });
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[referral] failed to approve affiliate", error);
    return NextResponse.json(
      { error: "Erro ao aprovar afiliado" },
      { status: 500 },
    );
  }
}

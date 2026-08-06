import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { parseAgreementTerms } from "@/lib/referral/agreement";
import {
  ReferralOperationError,
  renegotiateReferralAgreement,
} from "@/lib/referral/queries";
import {
  describeMigrationChoice,
  parseReferralMigrationChoice,
} from "@/lib/referral/renegotiation";

/**
 * Renegociação de acordo (ticket 13).
 *
 * Rota separada da aprovação de propósito: aprovar cria o primeiro acordo,
 * renegociar supera um que já existe e obriga a decidir o destino dos indicados
 * existentes. São operações diferentes, com pré-condições diferentes, e juntá-las
 * numa rota só faria a escolha de migração parecer opcional — que é exatamente o
 * que este ticket existe para impedir.
 *
 * A escolha é lida ANTES dos termos: um corpo sem `migrateExistingCustomers` é
 * recusado mesmo que o acordo novo esteja perfeito. Não há caminho que a pule.
 */
export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as {
      affiliateId?: unknown;
      migrateExistingCustomers?: unknown;
      format?: unknown;
      percentageBps?: unknown;
      fixedAmountCentavos?: unknown;
      duration?: unknown;
      durationCycles?: unknown;
    };

    const affiliateId =
      typeof body.affiliateId === "string" ? body.affiliateId : null;
    if (!affiliateId) {
      return NextResponse.json(
        { error: "Informe o afiliado a renegociar" },
        { status: 400 },
      );
    }

    const choice = parseReferralMigrationChoice(body.migrateExistingCustomers);
    if (!choice.ok) {
      return NextResponse.json({ error: choice.error }, { status: 400 });
    }

    const parsed = parseAgreementTerms(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await renegotiateReferralAgreement({
      affiliateId,
      terms: parsed.terms,
      choice: choice.choice,
      adminEmail: authz.actor.email,
    });

    return NextResponse.json({
      affiliateId,
      agreementId: result.agreement.id,
      previousAgreementId: result.previousAgreement.id,
      migrateExistingCustomers: result.choice === "migrate",
      migratedCustomerCount: result.migratedCustomerCount,
      totalCustomerCount: result.totalCustomerCount,
      summary: describeMigrationChoice(result.choice, result.totalCustomerCount),
    });
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[referral] failed to renegotiate agreement", error);
    return NextResponse.json(
      { error: "Erro ao renegociar o acordo" },
      { status: 500 },
    );
  }
}

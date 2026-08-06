import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { ReferralOperationError } from "@/lib/referral/queries";
import { writeOffReferralNegativeBalance } from "@/lib/referral/write-off-queries";

/**
 * Baixa de saldo negativo (ticket 12).
 *
 * O autor vem da SESSÃO, nunca do corpo: uma baixa que aceitasse o autor do
 * cliente não seria auditoria, seria um campo de texto. O motivo é obrigatório
 * e quem o exige é a função pura `evaluateReferralWriteOff`, chamada dentro da
 * transação — esta rota só traduz o corpo e o erro.
 */
export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as {
      affiliateId?: unknown;
      amountCentavos?: unknown;
      reason?: unknown;
    };

    const affiliateId =
      typeof body.affiliateId === "string" ? body.affiliateId : null;
    if (!affiliateId) {
      return NextResponse.json({ error: "Informe o afiliado" }, { status: 400 });
    }

    // Ausente = a dívida inteira. Um número mal formado NÃO vira "a dívida
    // inteira" por omissão: ele é recusado, porque adivinhar o valor de um
    // lançamento é como se cria um crédito indevido.
    let amountCentavos: number | null = null;
    if (body.amountCentavos !== undefined && body.amountCentavos !== null) {
      if (
        typeof body.amountCentavos !== "number" ||
        !Number.isSafeInteger(body.amountCentavos)
      ) {
        return NextResponse.json(
          { error: "O valor da baixa precisa ser um inteiro em centavos" },
          { status: 400 },
        );
      }
      amountCentavos = body.amountCentavos;
    }

    const result = await writeOffReferralNegativeBalance({
      affiliateId,
      amountCentavos,
      reason: typeof body.reason === "string" ? body.reason : "",
      adminEmail: authz.actor.email,
    });

    return NextResponse.json({
      ledgerEntryId: result.entry.id,
      amountCentavos: result.entry.amountCentavos,
      availableBeforeCentavos: result.balanceBefore.availableCentavos,
      availableAfterCentavos: result.availableAfterCentavos,
      clearsBalance: result.clearsBalance,
    });
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[referral] failed to write off negative balance", error);
    return NextResponse.json(
      { error: "Erro ao lançar a baixa" },
      { status: 500 },
    );
  }
}

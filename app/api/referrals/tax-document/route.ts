import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { parseTaxDocument } from "@/lib/referral/payout";
import {
  ReferralOperationError,
  updateReferralAffiliateTaxDocument,
} from "@/lib/referral/queries";

/**
 * Corrige o CPF/CNPJ do afiliado. É a ÚNICA porta de troca: o painel do
 * afiliado trava o documento depois do primeiro registro, e o serviço de saque
 * do frontend recusa qualquer tentativa de mudança vinda de lá. A validação dos
 * dígitos verificadores é a mesma do frontend, e a troca fica registrada em
 * `referral_admin_actions` com autor, valor antigo e novo.
 */
export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as {
      affiliateId?: unknown;
      taxDocument?: unknown;
    };

    const affiliateId =
      typeof body.affiliateId === "string" ? body.affiliateId : null;
    if (!affiliateId) {
      return NextResponse.json(
        { error: "Informe o afiliado" },
        { status: 400 },
      );
    }

    const parsed = parseTaxDocument(
      typeof body.taxDocument === "string" ? body.taxDocument : null,
    );
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.message }, { status: 400 });
    }

    const affiliate = await updateReferralAffiliateTaxDocument({
      affiliateId,
      taxDocument: { document: parsed.document, type: parsed.type },
      adminEmail: authz.actor.email,
    });

    return NextResponse.json({
      affiliateId: affiliate.id,
      taxDocument: {
        document: affiliate.taxDocument,
        type: affiliate.taxDocumentType,
      },
    });
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[referral] failed to update tax document", error);
    return NextResponse.json(
      { error: "Erro ao atualizar o documento" },
      { status: 500 },
    );
  }
}

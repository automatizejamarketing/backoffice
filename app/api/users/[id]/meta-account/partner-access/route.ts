import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import {
  buildPartnersSettingsUrl,
  getAutomatizeBusinessIdFromEnv,
} from "@/lib/meta-business/partner-access-status";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:read");
  if (!authz.ok) return authz.response;

  const account = await getUserMetaBusinessAccount(id);
  if (!account) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  const automatizeBusinessId = getAutomatizeBusinessIdFromEnv();
  const partnersUrl = buildPartnersSettingsUrl(account.clientBusinessId);

  return NextResponse.json({
    status: account.partnerAccessStatus,
    diagnosis: account.partnerAccessDiagnosis,
    checkedAt: account.partnerAccessCheckedAt,
    clientBusinessId: account.clientBusinessId,
    automatizeBusinessId,
    partnersUrl,
    instructions: [
      "Peça ao cliente para abrir Parceiros no Gerenciador de Negócios.",
      `Cole o ID da Automatize: ${automatizeBusinessId}.`,
      "Conceda acesso à Página, Instagram e conta de anúncios.",
      "Não peça a senha do Facebook do cliente.",
    ],
  });
}

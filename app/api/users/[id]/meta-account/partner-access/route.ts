import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import {
  AUTOMATIZE_PEOPLE_EMAIL,
  buildPeopleSettingsUrl,
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
  const peopleUrl = buildPeopleSettingsUrl(account.clientBusinessId);

  return NextResponse.json({
    status: account.partnerAccessStatus,
    diagnosis: account.partnerAccessDiagnosis,
    checkedAt: account.partnerAccessCheckedAt,
    clientBusinessId: account.clientBusinessId,
    automatizeBusinessId,
    peopleUrl,
    partnersUrl: peopleUrl,
    instructions: [
      "Peça ao cliente para abrir Pessoas no Gerenciador de Negócios.",
      `Cole o e-mail ${AUTOMATIZE_PEOPLE_EMAIL} e conceda acesso total.`,
      "Avance até enviar o convite.",
      "Não peça a senha do Facebook do cliente.",
    ],
  });
}

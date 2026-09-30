import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { handleAdAccountMoney } from "@/lib/meta-business/ad-account-money-handler";
import { readAdAccountMoney } from "@/lib/meta-business/ad-account-money-read";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { buildReconnectInfo } from "@/lib/meta-business/reconnect-link";

/**
 * GET /api/users/[id]/ad-accounts/[accountId]/money[?fresh=1]
 *
 * Saldo (pré-paga) ou fatura em aberto (pós-paga) + status da conta de anúncios,
 * com o token do cliente. `?fresh=1` ignora o cache de 5 minutos (botão "Atualizar").
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; accountId: string }> },
): Promise<Response> {
  const { id: userId, accountId } = await params;
  return handleAdAccountMoney(
    request,
    { userId, accountId },
    {
      authorize: (id) => requireMarketingUserAccessResponse(id, "marketing:read"),
      getAccessToken: getUserAccessTokenByUserId,
      readMoney: readAdAccountMoney,
      reconnectInfo: buildReconnectInfo,
    },
  );
}

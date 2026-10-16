import type {
  AdAccountMoneyErrorResponse,
  AdAccountMoneyRead,
  AdAccountMoneyResponse,
} from "@/lib/backoffice/ad-account-money-types";
import { stripActPrefix } from "@/lib/meta-business/account-match";
import { GraphApiError, graphErrorToClientError } from "@/lib/meta-business/error";
import type { GetAccessTokenResult } from "@/lib/meta-business/get-user-access-token";
import type { ReconnectInfo } from "@/lib/meta-business/reconnect-link";

type AuthzOutcome = { ok: true } | { ok: false; response: Response };

/**
 * Tudo que o handler toca fora de si, injetado para testar sem `mock.module`
 * (global e vazado entre arquivos no bun) — mesmo padrão de `create-pixel-handler`.
 */
export type AdAccountMoneyHandlerDeps = {
  authorize: (userId: string) => Promise<AuthzOutcome>;
  getAccessToken: (userId: string) => Promise<GetAccessTokenResult>;
  readMoney: (args: {
    adAccountId: string;
    accessToken: string;
    fresh: boolean;
  }) => Promise<AdAccountMoneyRead>;
  reconnectInfo: () => ReconnectInfo;
};

const ACCOUNT_ID_PATTERN = /^(act_)?\d+$/;

function json(body: AdAccountMoneyResponse | AdAccountMoneyErrorResponse, status: number) {
  return Response.json(body, { status });
}

/**
 * `GET /api/users/{id}/ad-accounts/{accountId}/money[?fresh=1]` — saldo
 * (pré-paga) ou fatura em aberto (pós-paga) + status da conta, lidos com o token
 * do cliente. Mesmo guard e mesmo formato de erro do `/api/users/{id}/ad-accounts`.
 * Leitura: sem auditoria (o backoffice só audita mutações).
 */
export async function handleAdAccountMoney(
  request: Request,
  params: { userId: string; accountId: string },
  deps: AdAccountMoneyHandlerDeps,
): Promise<Response> {
  // Tudo dentro do try: o guard RE-LANÇA falha de sessão/banco (rbac.ts), e sem
  // isso o Next responderia o 500 padrão dele em vez do JSON desta rota.
  try {
    const authz = await deps.authorize(params.userId);
    if (!authz.ok) return authz.response;

    if (!ACCOUNT_ID_PATTERN.test(params.accountId)) {
      return json({ error: "invalid_account_id", message: "Conta de anúncios inválida." }, 400);
    }

    const tokenResult = await deps.getAccessToken(params.userId);
    if (!tokenResult.success) {
      const { error } = tokenResult;
      return json(
        {
          error: error.error,
          message: error.message,
          solution: error.solution,
          needsReconnect: error.needsReconnect,
          ...(error.needsReconnect ? { reconnect: deps.reconnectInfo() } : {}),
        },
        error.statusCode,
      );
    }

    const fresh = new URL(request.url).searchParams.get("fresh") === "1";

    const read = await deps.readMoney({
      adAccountId: stripActPrefix(params.accountId),
      accessToken: tokenResult.accessToken,
      fresh,
    });
    return json({ ...read, connectionKind: tokenResult.connection.tokenKind }, 200);
  } catch (error) {
    if (error instanceof GraphApiError) {
      const errorReturn = error.errorReturn;
      const code = errorReturn.data?.code;
      const errorSubcode = errorReturn.data?.errorSubcode;
      // 190 (inclui 460/463): o token guardado morreu — só reconectando.
      const needsReconnect = code === 190;
      console.error("backoffice.adAccountMoney.graphError", { code, errorSubcode, needsReconnect });
      return json(
        {
          ...graphErrorToClientError(errorReturn),
          code,
          errorSubcode,
          needsReconnect,
          ...(needsReconnect ? { reconnect: deps.reconnectInfo() } : {}),
        },
        needsReconnect ? 409 : errorReturn.statusCode,
      );
    }

    console.error("backoffice.adAccountMoney.unexpected", error);
    return json(
      {
        error: "Internal server error",
        message: "Não foi possível consultar a Meta agora.",
        solution: "Tente de novo em instantes.",
      },
      500,
    );
  }
}

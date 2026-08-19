import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import type { BackofficeActor } from "@/lib/auth/rbac-core";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import {
  GraphApiError,
  graphErrorToClientError,
  isMetaTokenInvalid,
} from "@/lib/meta-business/error";
import { checkRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import type { SafeMetaConnection } from "@/lib/meta-business/connection-record";

export const stripActPrefix = (id: string) => id.replace(/^act_/, "");

export type AiCampaignAction =
  | "scan"
  | "plan"
  | "create"
  | "copy"
  | "video"
  | "video-status"
  | "fallback"
  | "previews";

export type AiCampaignAuth = {
  actor: BackofficeActor;
  userId: string;
  accountId: string;
  accessToken: string;
  connection: SafeMetaConnection | null;
};

type AuthFailure = { ok: false; response: NextResponse };
type AuthSuccess = { ok: true } & AiCampaignAuth;

function rateLimitResponse(retryAfterSeconds: number, limit: number) {
  return NextResponse.json(
    {
      success: false,
      error: "Too many requests. Please try again later.",
      message: "Muitas tentativas. Tente novamente em instantes.",
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}

export function tokenInvalidJson(): NextResponse<{
  success: false;
  error: string;
  message: string;
  solution: string;
  needsReconnect: true;
}> {
  return NextResponse.json(
    {
      success: false,
      error: "Invalid token",
      message: "A conexão do cliente com o Facebook expirou.",
      solution: "Peça ao cliente para reconectar a conta do Facebook.",
      needsReconnect: true,
    },
    { status: 401 },
  );
}

export function isTokenInvalidError(error: unknown): boolean {
  return isMetaTokenInvalid(error);
}

/**
 * Shared gate for AI campaign routes: RBAC write, in-memory rate limit keyed by
 * actor + customer, customer's Meta token, and ad-account membership.
 */
export async function authorizeAiCampaignWrite(
  request: NextRequest,
  accountIdParam: string,
  action: AiCampaignAction,
  options: { requireAccountAccess?: boolean } = {},
): Promise<AuthSuccess | AuthFailure> {
  const requireAccountAccess = options.requireAccountAccess ?? true;
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which customer's token to use",
        },
        { status: 400 },
      ),
    };
  }

  const authz = await requireMarketingUserAccessResponse(
    userId,
    "marketing:write",
  );
  if (!authz.ok) return { ok: false, response: authz.response };

  const limited = checkRateLimit(
    `meta-ai:${action}:${authz.actor.id}:${userId}`,
    RATE_LIMITS.META_AI_CAMPAIGN,
  );
  if (!limited.success) {
    return {
      ok: false,
      response: rateLimitResponse(limited.retryAfterSeconds, limited.limit),
    };
  }

  const tokenResult = await getUserAccessTokenByUserId(userId);
  if (!tokenResult.success) {
    if (!requireAccountAccess) {
      return {
        ok: true,
        actor: authz.actor,
        userId,
        accountId: stripActPrefix(accountIdParam),
        accessToken: "",
        connection: null,
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
          needsReconnect: tokenResult.error.needsReconnect,
        },
        { status: tokenResult.error.statusCode },
      ),
    };
  }

  const accountId = stripActPrefix(accountIdParam);
  if (requireAccountAccess && !accountId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Missing accountId",
          message: "Informe a conta de anúncio.",
        },
        { status: 400 },
      ),
    };
  }

  if (requireAccountAccess) {
    try {
      const userWithAdAccounts = await getUserWithAdAccounts(
        tokenResult.accessToken,
        {
          tokenKind: tokenResult.connection.tokenKind,
          bisuAppScopedId: tokenResult.connection.bisuAppScopedId,
          clientBusinessId: tokenResult.connection.clientBusinessId,
          connectionName: tokenResult.connection.name,
        },
      );
      const adAccounts = userWithAdAccounts.adaccounts?.data ?? [];
      const allowed = adAccounts.some(
        (account) =>
          account.account_id === accountId ||
          stripActPrefix(account.id) === accountId,
      );
      if (!allowed) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              success: false,
              error: "Account not accessible",
              message:
                "Esta conta de anúncio não está entre as contas que o cliente pode acessar.",
              solution: "Selecione outra conta de anúncio.",
            },
            { status: 403 },
          ),
        };
      }
    } catch (error) {
      if (isMetaTokenInvalid(error)) {
        return { ok: false, response: tokenInvalidJson() };
      }
      if (error instanceof GraphApiError) {
        const client = graphErrorToClientError(error.errorReturn);
        return {
          ok: false,
          response: NextResponse.json(
            { success: false, ...client },
            { status: error.errorReturn.statusCode },
          ),
        };
      }
      throw error;
    }
  }

  return {
    ok: true,
    actor: authz.actor,
    userId,
    accountId,
    accessToken: tokenResult.accessToken,
    connection: tokenResult.connection,
  };
}

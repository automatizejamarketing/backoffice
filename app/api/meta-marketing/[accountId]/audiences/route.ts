import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  AccountNotAccessibleError,
  assertCustomAudienceAccountAccess,
  listCustomAudiences,
} from "@/lib/meta-business/marketing/audiences";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";

type GetAudiencesResponse = {
  audiences: Awaited<ReturnType<typeof listCustomAudiences>>["items"];
  nextCursor?: string;
  hasNextPage: boolean;
  queriedAt: string;
  limitations: string[];
};

type GetAudiencesErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<GetAudiencesResponse | GetAudiencesErrorResponse>> {
  try {
    const { accountId } = await params;
    const userId = request.nextUrl.searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 },
      );
    }

    const authz = await requireMarketingUserAccessResponse(
      userId,
      "marketing:write",
    );
    if (!authz.ok) return authz.response;

    const tokenResult = await getUserAccessTokenByUserId(userId);

    if (!tokenResult.success) {
      return NextResponse.json(
        {
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
        },
        { status: tokenResult.error.statusCode },
      );
    }

    const connection = await getUserWithAdAccounts(tokenResult.accessToken, {
      tokenKind: tokenResult.connection.tokenKind,
      bisuAppScopedId: tokenResult.connection.bisuAppScopedId,
      clientBusinessId: tokenResult.connection.clientBusinessId,
      connectionName: tokenResult.connection.name,
    });
    assertCustomAudienceAccountAccess(
      accountId,
      connection.adaccounts?.data ?? [],
    );

    const page = await listCustomAudiences({
      adAccountId: accountId,
      accessToken: tokenResult.accessToken,
      detailed: request.nextUrl.searchParams.get("detailed") === "1",
      after: request.nextUrl.searchParams.get("after") ?? undefined,
    });

    return NextResponse.json({
      audiences: page.items,
      hasNextPage: page.truncated,
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      queriedAt: new Date().toISOString(),
      limitations: [
        "A consulta não comprova permissão para alterar, usar ou excluir o público.",
        "A Meta não informa membros individuais nem todos os usos em campanhas nesta consulta.",
      ],
    });
  } catch (error) {
    if (error instanceof AccountNotAccessibleError) {
      return NextResponse.json(
        { error: "Account not accessible", message: error.message },
        { status: 403 },
      );
    }
    const errorReturn = errorToGraphErrorReturn(error);

    return NextResponse.json(
      {
        error: errorReturn.reason.title,
        message: errorReturn.reason.message,
        solution: errorReturn.reason.solution,
      },
      { status: errorReturn.statusCode },
    );
  }
}

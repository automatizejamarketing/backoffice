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
import { metaApiCall } from "@/lib/meta-business/api";

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

/** Backoffice uses the client's own Meta connection and repeats both its RBAC
 * check and account lookup on confirmation.  The browser review is never an
 * authorization grant. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  try {
    const { accountId } = await params;
    const userId = request.nextUrl.searchParams.get("userId");
    const body = await request.json() as { action?: "review" | "confirm"; audienceId?: string; name?: string; description?: string; confirmationToken?: string };
    if (!userId || !body.audienceId || (body.name == null && body.description == null)) return NextResponse.json({ error: "Invalid metadata update" }, { status: 400 });
    const authz = await requireMarketingUserAccessResponse(userId, "marketing:write");
    if (!authz.ok) return authz.response;
    const tokenResult = await getUserAccessTokenByUserId(userId);
    if (!tokenResult.success) return NextResponse.json(tokenResult.error, { status: tokenResult.error.statusCode });
    const connection = await getUserWithAdAccounts(tokenResult.accessToken, { tokenKind: tokenResult.connection.tokenKind, bisuAppScopedId: tokenResult.connection.bisuAppScopedId, clientBusinessId: tokenResult.connection.clientBusinessId, connectionName: tokenResult.connection.name });
    assertCustomAudienceAccountAccess(accountId, connection.adaccounts?.data ?? []);
    const snapshot = await metaApiCall<{ account_id?: string; name?: string; description?: string; lookalike_audience_ids?: string[] }>({ method: "GET", path: body.audienceId, params: "fields=account_id,name,description,rule,lookalike_audience_ids", accessToken: tokenResult.accessToken });
    if (snapshot.account_id?.replace(/^act_/, "") !== accountId.replace(/^act_/, "")) return NextResponse.json({ error: "Audience not in account" }, { status: 403 });
    const before = { name: snapshot.name, description: snapshot.description }; const after = { name: body.name ?? snapshot.name, description: body.description ?? snapshot.description };
    const confirmationToken = JSON.stringify({ audienceId: body.audienceId, accountId, before, after });
    if (body.action === "confirm") {
      if (body.confirmationToken !== confirmationToken) return NextResponse.json({ error: "Stale review; review again before confirming" }, { status: 409 });
      const payload = new URLSearchParams(); if (body.name != null) payload.set("name", body.name); if (body.description != null) payload.set("description", body.description);
      await metaApiCall({ method: "POST", path: body.audienceId, params: "", body: payload, accessToken: tokenResult.accessToken });
      return NextResponse.json({ ok: true, id: body.audienceId });
    }
    const adsets = await metaApiCall<{ data?: Array<{ id?: string; name?: string; campaign?: { id?: string; name?: string }; targeting?: { custom_audiences?: Array<{ id?: string }>; excluded_custom_audiences?: Array<{ id?: string }> } }>; paging?: { next?: string } }>({ method: "GET", path: `act_${accountId.replace(/^act_/, "")}/adsets`, params: "fields=id,name,campaign{id,name},targeting{custom_audiences,excluded_custom_audiences}&limit=200", accessToken: tokenResult.accessToken });
    const knownUses = (adsets.data ?? []).flatMap((adset) => ["include", "exclude"].flatMap((placement) => (placement === "include" ? adset.targeting?.custom_audiences : adset.targeting?.excluded_custom_audiences)?.some((ref) => ref.id === body.audienceId) && adset.id ? [{ adSetId: adset.id, adSetName: adset.name, campaignId: adset.campaign?.id, campaignName: adset.campaign?.name, placement }] : []));
    return NextResponse.json({ ok: true, before, after, confirmationToken, impact: { knownUses, dependentAudienceIds: snapshot.lookalike_audience_ids ?? [], coverage: adsets.paging?.next ? "incomplete" : "complete", limitations: adsets.paging?.next ? ["A consulta possui mais páginas; podem existir usos não exibidos."] : ["A Meta não garante a ausência global de anúncios afetados."] } });
  } catch (error) { const errorReturn = errorToGraphErrorReturn(error); return NextResponse.json({ error: errorReturn.reason.title, message: errorReturn.reason.message, solution: errorReturn.reason.solution }, { status: errorReturn.statusCode }); }
}

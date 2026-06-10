import { enterMetaMutationLog, updateMetaMutationContext } from "@/lib/observability/meta-log-context";
import { logMetaMutationError } from "@/lib/observability/meta-logger";
import { attachCorrelationId } from "@/lib/observability/with-meta-logging";
import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  errorToGraphErrorReturn,
  graphErrorToClientError,
} from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { duplicateAd } from "@/lib/meta-business/duplicate";
import { createDuplicationLog } from "@/lib/db/admin-queries";

export type DuplicateAdResponse = {
  success: boolean;
  id: string;
  name: string;
  auditLogFailed?: boolean;
};

export type DuplicateErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

export type DuplicateAdRequestBody = {
  promotionUrl?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adId: string }> },
): Promise<NextResponse<DuplicateAdResponse | DuplicateErrorResponse>> {
  enterMetaMutationLog({
    app: "backoffice",
    route: "POST /api/meta-marketing/{accountId}/ads/{adId}/duplicate",
    operationHint: "duplicate",
    entityHint: "ad",
  });
  try {
    const { accountId, adId } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

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

    updateMetaMutationContext({
      actor: {
        kind: "backoffice",
        id: authz.actor.id,
        email: authz.actor.email,
        role: authz.actor.role,
        targetUserId: userId,
      },
      parentIds: { adAccountId: accountId },
    });

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

    const body: DuplicateAdRequestBody = await request
      .json()
      .catch(() => ({}));
    const promotionUrl = body.promotionUrl?.trim();

    const result = await duplicateAd({
      accountId,
      adId,
      accessToken: tokenResult.accessToken,
      ...(promotionUrl && { fallbackPromotionUrl: promotionUrl }),
    });

    let auditLogFailed = false;
    try {
      await createDuplicationLog({
        backofficeUserEmail: authz.actor.email,
        targetUserId: userId,
        entity: "ad",
        sourceId: adId,
        sourceName: result.sourceName,
        newId: result.id,
        newName: result.name,
      });
    } catch (dbErr) {
      logMetaMutationError(dbErr);
    console.error("[POST ad duplicate] audit log failed:", dbErr);
      auditLogFailed = true;
    }

    return NextResponse.json(
      { success: true, id: result.id, name: result.name, auditLogFailed },
      { status: 201 },
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    const clientError = graphErrorToClientError(errorReturn);
    console.error("[POST ad duplicate] Error:", errorReturn);

    return NextResponse.json(
      {
        error: clientError.error,
        message: clientError.message,
        solution: clientError.solution,
      },
      { status: errorReturn.statusCode },
    );
  }
}

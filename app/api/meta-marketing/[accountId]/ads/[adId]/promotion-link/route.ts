import { enterMetaMutationLog, updateMetaMutationContext } from "@/lib/observability/meta-log-context";
import { logMetaMutationError } from "@/lib/observability/meta-logger";
import { attachCorrelationId } from "@/lib/observability/with-meta-logging";
import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { createAdCreativeEditLog } from "@/lib/db/admin-queries";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  getPromotionLinkDetails,
  updatePromotionLink,
  type PromotionLinkUpdateResult,
} from "@/lib/meta-business/marketing/promotion-link-edit";

type PromotionLinkGetResponse = {
  adId: string;
  creativeId: string;
  campaignObjective?: string;
  promotionUrl?: string;
  ctaType?: string;
};

type PromotionLinkPatchRequest = {
  promotionUrl?: string;
};

type PromotionLinkPatchResponse = PromotionLinkUpdateResult & {
  auditLogFailed?: boolean;
};

type PromotionLinkErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

function isValidHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adId: string }> },
): Promise<NextResponse<PromotionLinkGetResponse | PromotionLinkErrorResponse>> {
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

    const authz = await requireMarketingUserAccessResponse(userId);
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

    const details = await getPromotionLinkDetails({
      adId,
      accessToken: tokenResult.accessToken,
    });

    return NextResponse.json(details, { status: 200 });
  } catch (error) {
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adId: string }> },
): Promise<
  NextResponse<PromotionLinkPatchResponse | PromotionLinkErrorResponse>
> {
  enterMetaMutationLog({
    app: "backoffice",
    route: "PATCH /api/meta-marketing/{accountId}/ads/{adId}/promotion-link",
    operationHint: "update",
    entityHint: "adcreative",
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

    const body = (await request.json()) as PromotionLinkPatchRequest;
    const promotionUrl = body.promotionUrl?.trim();

    if (!promotionUrl || !isValidHttpsUrl(promotionUrl)) {
      return NextResponse.json(
        {
          error: "URL inválida",
          message: "Informe uma URL de promoção válida começando com https://.",
          solution: "Revise o link e tente novamente.",
        },
        { status: 400 },
      );
    }

    const result = await updatePromotionLink({
      accountId,
      adId,
      accessToken: tokenResult.accessToken,
      promotionUrl,
    });

    let auditLogFailed = false;
    try {
      await createAdCreativeEditLog({
        backofficeUserEmail: authz.actor.email,
        targetUserId: userId,
        accountId,
        campaignId: result.campaignId ?? null,
        adsetId: result.adsetId ?? "",
        operation: "edit",
        editStrategy: result.strategy,
        sourceAdId: adId,
        resultAdId: result.adId,
        pausedAdId: result.pausedAdId,
        creativeId: result.creativeId,
        mediaSource: "existing_creative",
        mediaKind: undefined,
        appliedToMeta: true,
        message:
          result.message ??
          `Link de promoção atualizado de ${result.previousPromotionUrl ?? "(sem link)"} para ${result.newPromotionUrl}.`,
      });
    } catch (dbErr) {
      logMetaMutationError(dbErr);
    console.error("[promotion-link PATCH] audit log failed:", dbErr);
      auditLogFailed = true;
    }

    return NextResponse.json({ ...result, auditLogFailed }, { status: 200 });
  } catch (error) {
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

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
import {
  duplicateAdSet,
  DuplicateInProgressError,
  duplicateErrorExtras,
  type SkippedItem,
  type ReplacedInterestsItem,
  type RepairedCreativeItem,
  type RebuiltAdsetItem,
} from "@/lib/meta-business/duplicate";
import { createDuplicationLog } from "@/lib/db/admin-queries";

/**
 * The async deep-copy fast path polls Meta's request set within the request; allow
 * up to 60s so larger ad sets finish before we report "in progress" or fall back.
 */
export const maxDuration = 60;

export type DuplicateAdSetResponse = {
  success: boolean;
  id: string;
  name: string;
  auditLogFailed?: boolean;
  /** Ads skipped (un-copyable) during a partial duplication. */
  skippedAds?: SkippedItem[];
  /** Deprecated targeting interests swapped for Meta's alternatives during a rebuild. */
  replacedInterests?: ReplacedInterestsItem[];
  /** Ads whose creative was adjusted for compatibility (crop, enhancements, link). */
  repairedCreatives?: RepairedCreativeItem[];
  /** Ad sets reconstructed instead of natively copied (review config/dates). */
  rebuiltAdsets?: RebuiltAdsetItem[];
};

export type DuplicateErrorResponse = {
  error: string;
  message: string;
  solution?: string;
  rolledBack?: boolean;
  orphanIds?: string[];
};

/** Async deep-copy still running on Meta's side when the request budget ran out. */
export type DuplicateInProgressResponse = {
  success: boolean;
  inProgress: boolean;
  message: string;
};

export type DuplicateAdSetRequestBody = {
  promotionUrl?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adsetId: string }> },
): Promise<
  NextResponse<
    DuplicateAdSetResponse | DuplicateInProgressResponse | DuplicateErrorResponse
  >
> {
  enterMetaMutationLog({
    app: "backoffice",
    route: "POST /api/meta-marketing/{accountId}/adsets/{adsetId}/duplicate",
    operationHint: "duplicate",
    entityHint: "adset",
  });
  try {
    const { accountId, adsetId } = await params;
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

    const body: DuplicateAdSetRequestBody = await request
      .json()
      .catch(() => ({}));
    const promotionUrl = body.promotionUrl?.trim();

    const result = await duplicateAdSet({
      accountId,
      adsetId,
      accessToken: tokenResult.accessToken,
      ...(promotionUrl && { fallbackPromotionUrl: promotionUrl }),
    });

    let auditLogFailed = false;
    try {
      await createDuplicationLog({
        backofficeUserEmail: authz.actor.email,
        targetUserId: userId,
        entity: "adset",
        sourceId: adsetId,
        sourceName: result.sourceName,
        newId: result.id,
        newName: result.name,
      });
    } catch (dbErr) {
      logMetaMutationError(dbErr);
    console.error("[POST adset duplicate] audit log failed:", dbErr);
      auditLogFailed = true;
    }

    return NextResponse.json(
      {
        success: true,
        id: result.id,
        name: result.name,
        auditLogFailed,
        ...(result.skippedAds?.length ? { skippedAds: result.skippedAds } : {}),
        ...(result.replacedInterests?.length
          ? { replacedInterests: result.replacedInterests }
          : {}),
        ...(result.repairedCreatives?.length
          ? { repairedCreatives: result.repairedCreatives }
          : {}),
        ...(result.rebuiltAdsets?.length
          ? { rebuiltAdsets: result.rebuiltAdsets }
          : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DuplicateInProgressError) {
      return NextResponse.json(
        {
          success: true,
          inProgress: true,
          message:
            "A duplicação está em andamento na Meta e pode levar alguns instantes. Atualize a lista em breve para ver a cópia.",
        },
        { status: 202 },
      );
    }
    const errorReturn = errorToGraphErrorReturn(error);
    const clientError = graphErrorToClientError(errorReturn);
    console.error("[POST adset duplicate] Error:", errorReturn);

    return NextResponse.json(
      {
        error: clientError.error,
        message: clientError.message,
        solution: clientError.solution,
        ...duplicateErrorExtras(error),
      },
      { status: errorReturn.statusCode },
    );
  }
}

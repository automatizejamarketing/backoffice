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
  duplicateCampaign,
  DuplicateInProgressError,
  DuplicateScheduleRefusedError,
  duplicateErrorExtras,
  type SkippedItem,
  type ReplacedInterestsItem,
  type RepairedCreativeItem,
  type RebuiltAdsetItem,
  type RepairedCampaignInfo,
} from "@/lib/meta-business/duplicate";
import { createDuplicationLog } from "@/lib/db/admin-queries";
import {
  type CampaignDeliveryMode,
  type CampaignScheduleBlock,
  describeScheduleOverride,
  scheduleOverrideFromRequest,
} from "@/lib/meta-business/campaign-schedule";

/**
 * The async deep-copy fast path polls Meta's request set within the request; allow
 * up to 60s so larger trees finish before we report "in progress" or fall back.
 */
export const maxDuration = 60;

/**
 * Time reserved at the end of the budget for the rollback and the JSON response. The
 * rollback is a single root delete (Meta cascades), measured at ~2 s; 15 s is that with
 * a wide margin. Mirrors the frontend's campaign duplicate route.
 */
const DUPLICATE_TIME_RESERVE_MS = 15_000;

export type DuplicateCampaignResponse = {
  success: boolean;
  id: string;
  name: string;
  auditLogFailed?: boolean;
  /** Ads skipped (un-copyable) during a partial duplication. */
  skippedAds?: SkippedItem[];
  /** Ad sets dropped because all their ads were skipped. */
  skippedAdsets?: SkippedItem[];
  /** Deprecated targeting interests swapped for Meta's alternatives during a rebuild. */
  replacedInterests?: ReplacedInterestsItem[];
  /** Ads whose creative was adjusted for compatibility (crop, enhancements, link). */
  repairedCreatives?: RepairedCreativeItem[];
  /** Ad sets reconstructed instead of natively copied (review config/dates). */
  rebuiltAdsets?: RebuiltAdsetItem[];
  /** Copy's lifetime ad sets given a fresh future flight window (start ~2h, duration kept). */
  scheduleAdjusted?: boolean;
  /** A native copy's schedule patch failed, leaving its inherited (possibly past) window. */
  scheduleAdjustFailed?: boolean;
  /** Dead promoted-object ids replaced on the copy (1885015); the copy is PAUSED for review. */
  repairedCampaign?: RepairedCampaignInfo;
  scheduleApplied?: boolean;
  /** Old lifetime CBO copy converted to programmed (true) or refused by Meta (false). */
  scheduleConverted?: boolean;
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

export type DuplicateCampaignRequestBody = {
  /** Website URL injected into ad copies whose creative lacks one (sales). */
  promotionUrl?: string;
  /** "Duplicar com novo horário": dias e horários de TODOS os conjuntos da cópia. */
  deliveryMode?: CampaignDeliveryMode;
  scheduleBlocks?: CampaignScheduleBlock[];
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; campaignId: string }> },
): Promise<
  NextResponse<
    | DuplicateCampaignResponse
    | DuplicateInProgressResponse
    | DuplicateErrorResponse
  >
> {
  enterMetaMutationLog({
    app: "backoffice",
    route: "POST /api/meta-marketing/{accountId}/campaigns/{campaignId}/duplicate",
    operationHint: "duplicate",
    entityHint: "campaign",
  });

  // Started before any work so the engine's deadline covers the whole invocation, not
  // just the copy loop. Past it the engine stops creating, rolls back and throws
  // DuplicateTimeBudgetError (a GraphApiError, 503) — the platform must never be the
  // thing that ends this request.
  const deadlineAt = Date.now() + maxDuration * 1000 - DUPLICATE_TIME_RESERVE_MS;

  try {
    const { accountId, campaignId } = await params;
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


    const body: DuplicateCampaignRequestBody = await request
      .json()
      .catch(() => ({}));
    const promotionUrl = body.promotionUrl?.trim();
    const schedule = scheduleOverrideFromRequest(body);
    if (!schedule.ok) {
      return NextResponse.json(
        attachCorrelationId({
          error: "Invalid delivery schedule",
          message: "Revise os dias e horários da cópia antes de duplicar.",
          solution:
            "Use blocos de pelo menos 1 hora, sem sobreposição no mesmo dia.",
        }),
        { status: 400 },
      );
    }

    const result = await duplicateCampaign({
      accountId,
      campaignId,
      accessToken: tokenResult.accessToken,
      deadlineAt,
      ...(promotionUrl && { fallbackPromotionUrl: promotionUrl }),
      ...(schedule.override ? { adSetSchedule: schedule.override } : {}),
    });

    const conversionNote =
      result.scheduleConverted === true
        ? "cópia nasceu programada"
        : result.scheduleConverted === false
          ? "Meta recusou a programação na cópia"
          : undefined;
    const scheduleNote = [
      schedule.override ? describeScheduleOverride(schedule.override) : undefined,
      conversionNote,
    ]
      .filter(Boolean)
      .join("; ");

    let auditLogFailed = false;
    try {
      await createDuplicationLog({
        backofficeUserEmail: authz.actor.email,
        targetUserId: userId,
        entity: "campaign",
        sourceId: campaignId,
        sourceName: result.sourceName,
        newId: result.id,
        newName: result.name,
        ...(scheduleNote ? { scheduleNote } : {}),
      });
    } catch (dbErr) {
      logMetaMutationError(dbErr);
    console.error("[POST campaign duplicate] audit log failed:", dbErr);
      auditLogFailed = true;
    }

    return NextResponse.json(
      {
        success: true,
        id: result.id,
        name: result.name,
        auditLogFailed,
        ...(result.skippedAds?.length ? { skippedAds: result.skippedAds } : {}),
        ...(result.skippedAdsets?.length
          ? { skippedAdsets: result.skippedAdsets }
          : {}),
        ...(result.replacedInterests?.length
          ? { replacedInterests: result.replacedInterests }
          : {}),
        ...(result.repairedCreatives?.length
          ? { repairedCreatives: result.repairedCreatives }
          : {}),
        ...(result.rebuiltAdsets?.length
          ? { rebuiltAdsets: result.rebuiltAdsets }
          : {}),
        ...(result.scheduleAdjusted ? { scheduleAdjusted: true } : {}),
        ...(result.scheduleAdjustFailed ? { scheduleAdjustFailed: true } : {}),
        ...(result.repairedCampaign
          ? { repairedCampaign: result.repairedCampaign }
          : {}),
        ...(result.scheduleApplied ? { scheduleApplied: true } : {}),
        scheduleConverted: result.scheduleConverted,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof DuplicateScheduleRefusedError) {
      // Recusa decidida antes de qualquer escrita (etapa 2): nada a desfazer.
      return NextResponse.json(
        {
          error: error.code,
          message: error.errorReturn.reason.message,
          solution: error.errorReturn.reason.solution,
        },
        { status: 400 },
      );
    }
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
    console.error("[POST campaign duplicate] Error:", errorReturn);

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

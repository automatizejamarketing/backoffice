import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { createAdSetEditLog } from "@/lib/db/admin-queries";
import type {
  AdSetTargeting,
  AudienceRef,
  GraphApiAdSet,
} from "@/lib/meta-business/types";

type EditAdSetRequestBody = {
  userId: string;
  campaignId?: string;
  adsetName?: string;
  dailyBudget?: number;
  targeting?: {
    age_min?: number;
    age_max?: number;
    genders?: number[];
    geo_locations?: {
      countries?: string[];
    };
    custom_audiences?: AudienceRef[];
    excluded_custom_audiences?: AudienceRef[];
  };
  note: string;
};

type EditAdSetResponse = {
  success: boolean;
  logId?: string;
  /** True when Meta applied but DB audit log insert failed */
  auditLogFailed?: boolean;
  auditLogError?: string;
  changes?: {
    dailyBudget?: { previous: string | null; new: string };
    targeting?: { previous: AdSetTargeting | null; new: AdSetTargeting };
  };
};

type EditAdSetErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adsetId: string }> },
): Promise<NextResponse<EditAdSetResponse | EditAdSetErrorResponse>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Not authenticated",
          message: "You must be logged in to access this resource",
          solution: "Please log in and try again",
        },
        { status: 401 },
      );
    }

    const backofficeUserEmail = session.user.email?.trim();
    if (!backofficeUserEmail) {
      return NextResponse.json(
        {
          error: "Missing admin email",
          message: "Sua sessão não possui email. Faça login novamente.",
          solution: "Encerre a sessão e entre novamente com Google.",
        },
        { status: 400 },
      );
    }

    const { accountId, adsetId } = await params;

    const body: EditAdSetRequestBody = await request.json();
    const { userId, campaignId, adsetName, dailyBudget, targeting, note } =
      body;

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId is required in the request body",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 },
      );
    }

    if (!note || note.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Missing note",
          message: "A note explaining the change is required",
          solution: "Provide a note to explain why this change is being made",
        },
        { status: 400 },
      );
    }

    const hasBudgetChange = dailyBudget !== undefined;
    const hasTargetingChange =
      targeting !== undefined &&
      (targeting.age_min !== undefined ||
        targeting.age_max !== undefined ||
        targeting.genders !== undefined ||
        targeting.custom_audiences !== undefined ||
        targeting.excluded_custom_audiences !== undefined);

    if (!hasBudgetChange && !hasTargetingChange) {
      return NextResponse.json(
        {
          error: "No changes provided",
          message: "At least one of dailyBudget or targeting must be provided",
          solution: "Provide dailyBudget and/or targeting fields to update",
        },
        { status: 400 },
      );
    }

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

    const { accessToken } = tokenResult;

    const currentAdSet = await metaApiCall<GraphApiAdSet>({
      domain: "FACEBOOK",
      method: "GET",
      path: adsetId,
      params: "fields=id,name,daily_budget,campaign_id,targeting",
      accessToken,
    });

    const previousDailyBudget = currentAdSet.daily_budget ?? null;
    const previousTargeting = currentAdSet.targeting ?? null;
    const usesCBO = previousDailyBudget === null;

    const updateParams: Record<string, string> = {};
    const changes: EditAdSetResponse["changes"] = {};

    if (hasBudgetChange) {
      if (usesCBO) {
        return NextResponse.json(
          {
            error: "Campaign uses CBO",
            message:
              "Este conjunto de anúncios pertence a uma campanha com Orçamento de Campanha (CBO). O orçamento diário não pode ser alterado no nível do conjunto de anúncios.",
            solution:
              "Para alterar o orçamento, edite-o diretamente na campanha.",
          },
          { status: 400 },
        );
      }

      const budgetInCents = Math.round(dailyBudget * 100);
      updateParams.daily_budget = budgetInCents.toString();
      changes.dailyBudget = {
        previous: previousDailyBudget,
        new: budgetInCents.toString(),
      };
    }

    let newTargeting: AdSetTargeting | undefined;
    if (hasTargetingChange) {
      const prevGeoLocations = previousTargeting?.geo_locations;

      if (
        !prevGeoLocations ||
        (!prevGeoLocations.countries?.length &&
          !prevGeoLocations.cities?.length &&
          !prevGeoLocations.regions?.length)
      ) {
        return NextResponse.json(
          {
            error: "Missing geo_locations",
            message:
              "O conjunto de anúncios não possui localização geográfica configurada. A localização não pode ser alterada através desta interface.",
            solution:
              "Configure a localização geográfica diretamente na Meta ou entre em contato com o suporte.",
          },
          { status: 400 },
        );
      }

      const newGeoLocations = prevGeoLocations;

      const newGenders =
        targeting.genders !== undefined
          ? targeting.genders
          : previousTargeting?.genders;

      const newCustomAudiences =
        targeting.custom_audiences !== undefined
          ? targeting.custom_audiences
          : previousTargeting?.custom_audiences;

      const newExcludedAudiences =
        targeting.excluded_custom_audiences !== undefined
          ? targeting.excluded_custom_audiences
          : previousTargeting?.excluded_custom_audiences;

      const prevRelaxation = previousTargeting?.targeting_relaxation_types as
        | Record<string, unknown>
        | undefined;

      newTargeting = {
        geo_locations: newGeoLocations,
        age_min: targeting.age_min ?? previousTargeting?.age_min ?? 18,
        age_max: targeting.age_max ?? previousTargeting?.age_max ?? 65,
        ...(newGenders?.length && { genders: newGenders }),
        ...(newCustomAudiences?.length && {
          custom_audiences: newCustomAudiences,
        }),
        ...(newExcludedAudiences?.length && {
          excluded_custom_audiences: newExcludedAudiences,
        }),
        ...(prevRelaxation && { targeting_relaxation_types: prevRelaxation }),
      };

      const metaTargeting: AdSetTargeting = {
        ...newTargeting,
        ...(newCustomAudiences?.length && {
          custom_audiences: newCustomAudiences.map((a) => ({ id: a.id })),
        }),
        ...(newExcludedAudiences?.length && {
          excluded_custom_audiences: newExcludedAudiences.map((a) => ({
            id: a.id,
          })),
        }),
      };

      if (metaTargeting.geo_locations) {
        const src = metaTargeting.geo_locations;
        const cleanGeo: typeof metaTargeting.geo_locations = {};
        if (src.countries?.length) cleanGeo.countries = src.countries;
        if (src.cities?.length) cleanGeo.cities = src.cities;
        if (src.regions?.length) cleanGeo.regions = src.regions;
        if (src.location_types?.length)
          cleanGeo.location_types = src.location_types;
        metaTargeting.geo_locations = cleanGeo;
        newTargeting.geo_locations = cleanGeo;
      }

      updateParams.targeting = JSON.stringify(metaTargeting);
      changes.targeting = {
        previous: previousTargeting,
        new: newTargeting,
      };
    }

    let appliedToMeta = false;
    let errorMessage: string | undefined;

    try {
      await metaApiCall<{ success: boolean }>({
        domain: "FACEBOOK",
        method: "POST",
        path: adsetId,
        params: "",
        body: new URLSearchParams(updateParams),
        accessToken,
      });
      appliedToMeta = true;
    } catch (metaError) {
      const errorReturn = errorToGraphErrorReturn(metaError);
      errorMessage = `${errorReturn.reason.title}: ${errorReturn.reason.message}`;
    }

    let logId: string | undefined;
    let auditLogFailed = false;
    let auditLogError: string | undefined;

    try {
      const log = await createAdSetEditLog({
        backofficeUserEmail,
        targetUserId: userId,
        adsetId,
        accountId: accountId.startsWith("act_") ? accountId : `act_${accountId}`,
        campaignId: campaignId ?? currentAdSet.campaign_id,
        adsetName: adsetName ?? currentAdSet.name,
        previousDailyBudget: previousDailyBudget ?? undefined,
        newDailyBudget: hasBudgetChange
          ? Math.round(dailyBudget * 100).toString()
          : undefined,
        previousTargeting: previousTargeting ?? undefined,
        newTargeting: newTargeting,
        note: note.trim(),
        appliedToMeta,
        errorMessage,
      });
      logId = log.id;
    } catch (dbErr) {
      console.error("[PATCH adset edit] Failed to write adset_edit_logs:", dbErr);
      auditLogFailed = true;
      auditLogError =
        dbErr instanceof Error ? dbErr.message : "Falha ao registrar auditoria";
    }

    if (!appliedToMeta) {
      return NextResponse.json(
        {
          error: "Failed to apply changes to Meta",
          message: errorMessage ?? "Unknown error occurred",
          solution: "The change was logged but not applied. Please try again.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        logId,
        ...(auditLogFailed && {
          auditLogFailed: true,
          auditLogError,
        }),
        changes,
      },
      { status: 200 },
    );
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

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { createAdSetEditLog } from "@/lib/db/admin-queries";
import type { AdSetTargeting, GraphApiAdSet } from "@/lib/meta-business/types";

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
  };
  note: string;
};

type EditAdSetResponse = {
  success: boolean;
  logId?: string;
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

    const backofficeUserId = session.user.id;
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
        (targeting.geo_locations?.countries &&
          targeting.geo_locations.countries.length > 0));

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
      // Build targeting with only the essential fields that Meta accepts for updates
      // We need to preserve geo_locations from previous targeting if not provided
      const prevGeoLocations = previousTargeting?.geo_locations;
      const newGeoLocations = targeting.geo_locations?.countries?.length
        ? { countries: targeting.geo_locations.countries }
        : prevGeoLocations
          ? {
              countries: prevGeoLocations.countries,
              cities: prevGeoLocations.cities,
              regions: prevGeoLocations.regions,
            }
          : undefined;

      if (
        !newGeoLocations ||
        (!newGeoLocations.countries?.length &&
          !newGeoLocations.cities?.length &&
          !newGeoLocations.regions?.length)
      ) {
        return NextResponse.json(
          {
            error: "Missing geo_locations",
            message:
              "geo_locations is required when updating targeting. The ad set must have at least one country, city, or region defined.",
            solution:
              "Include geo_locations.countries in the targeting object or ensure the ad set already has geographic targeting configured.",
          },
          { status: 400 },
        );
      }

      const newGenders =
        targeting.genders !== undefined
          ? targeting.genders
          : previousTargeting?.genders;

      // Build a clean targeting object with only the fields Meta accepts
      newTargeting = {
        geo_locations: newGeoLocations,
        age_min: targeting.age_min ?? previousTargeting?.age_min ?? 18,
        age_max: targeting.age_max ?? previousTargeting?.age_max ?? 65,
        ...(newGenders?.length && { genders: newGenders }),
      };

      // Clean up geo_locations - remove undefined/empty arrays
      if (newTargeting.geo_locations) {
        const cleanGeo: typeof newTargeting.geo_locations = {};
        if (newTargeting.geo_locations.countries?.length) {
          cleanGeo.countries = newTargeting.geo_locations.countries;
        }
        if (newTargeting.geo_locations.cities?.length) {
          cleanGeo.cities = newTargeting.geo_locations.cities;
        }
        if (newTargeting.geo_locations.regions?.length) {
          cleanGeo.regions = newTargeting.geo_locations.regions;
        }
        newTargeting.geo_locations = cleanGeo;
      }

      updateParams.targeting = JSON.stringify(newTargeting);
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

    const log = await createAdSetEditLog({
      backofficeUserId,
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
        logId: log.id,
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

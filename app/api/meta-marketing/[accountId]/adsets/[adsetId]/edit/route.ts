import { enterMetaMutationLog, updateMetaMutationContext } from "@/lib/observability/meta-log-context";
import { logMetaMutationError } from "@/lib/observability/meta-logger";
import { attachCorrelationId } from "@/lib/observability/with-meta-logging";
import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { createAdSetEditLog } from "@/lib/db/admin-queries";
import {
  currencyToMinorUnits,
  isEndAfterStart,
  isValidDateTimeLocal,
} from "@/lib/meta-business/budget-schedule";
import type {
  CampaignDeliveryMode,
  CampaignScheduleBlock,
} from "@/lib/meta-business/campaign-schedule";
import {
  toMetaAdSetScheduleBlocks,
  validateCampaignSchedulePayload,
} from "@/lib/meta-business/campaign-schedule";
import type {
  AdSetTargeting,
  AudienceRef,
  GraphApiAdSet,
  GraphApiCampaign,
} from "@/lib/meta-business/types";
import type { GeoLocationsPayload } from "@/lib/meta-business/geo-targeting-types";
import { sanitizeGeoLocationsForMeta } from "@/lib/meta-business/geo-locations";
import {
  applyInterestTargetingToMetaTargeting,
  preserveDetailedTargetingFields,
  type InterestTargetingValue,
} from "@/lib/meta-business/interest-targeting-types";
import { validateInterestTargetingForEdit } from "@/lib/meta-business/parse-interest-targeting-request";
import {
  INSTAGRAM_PLACEMENTS,
  isValidPlacementKey,
  placementsToTargetingFields,
  type PlacementKey,
} from "@/lib/meta-business/placements";
import {
  type CreateIssue,
  validateAdvantageAudienceAgeMax,
  validateGeoLocationsPresent,
} from "@/lib/meta-business/marketing/update";

type EditAdSetRequestBody = {
  userId: string;
  campaignId?: string;
  adsetName?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  startTime?: string;
  endTime?: string;
  deliveryMode?: CampaignDeliveryMode;
  scheduleBlocks?: CampaignScheduleBlock[];
  targeting?: {
    age_min?: number;
    age_max?: number;
    genders?: number[];
    geo_locations?: GeoLocationsPayload;
    custom_audiences?: AudienceRef[];
    excluded_custom_audiences?: AudienceRef[];
    placements?: PlacementKey[];
    interest_targeting?: InterestTargetingValue;
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
    deliverySchedule?: {
      previousPacingType?: GraphApiAdSet["pacing_type"];
      newPacingType: string[];
      previousAdsetSchedule?: GraphApiAdSet["adset_schedule"];
      newAdsetSchedule: ReturnType<typeof toMetaAdSetScheduleBlocks>;
    };
  };
};

type EditAdSetErrorResponse = {
  error: string;
  message: string;
  solution?: string;
  /** Structured problem + suggestion list, mirroring the creation primitives. */
  issues?: CreateIssue[];
};

function hasPositiveMinorUnits(value: string | null | undefined): value is string {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adsetId: string }> },
): Promise<NextResponse<EditAdSetResponse | EditAdSetErrorResponse>> {
  enterMetaMutationLog({
    app: "backoffice",
    route: "PATCH /api/meta-marketing/{accountId}/adsets/{adsetId}/edit",
    operationHint: "update",
    entityHint: "adset",
  });
  try {
    const { accountId, adsetId } = await params;

    const body: EditAdSetRequestBody = await request.json();
    const {
      userId,
      campaignId,
      adsetName,
      dailyBudget,
      lifetimeBudget,
      startTime,
      endTime,
      deliveryMode,
      scheduleBlocks,
      targeting,
      note,
    } = body;

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

    const backofficeUserEmail = authz.actor.email;

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

    const hasDailyBudgetChange = dailyBudget !== undefined;
    const hasLifetimeBudgetChange = lifetimeBudget !== undefined;
    const hasScheduleChange = startTime !== undefined || endTime !== undefined;
    const hasDeliveryScheduleChange =
      deliveryMode !== undefined || scheduleBlocks !== undefined;
    const hasTargetingChange =
      targeting !== undefined &&
      (targeting.age_min !== undefined ||
        targeting.age_max !== undefined ||
        targeting.genders !== undefined ||
        targeting.geo_locations !== undefined ||
        targeting.custom_audiences !== undefined ||
        targeting.excluded_custom_audiences !== undefined ||
        targeting.placements !== undefined ||
        targeting.interest_targeting !== undefined);

    if (targeting?.placements !== undefined) {
      if (!Array.isArray(targeting.placements) || targeting.placements.length === 0) {
        return NextResponse.json(
          {
            error: "Invalid placements",
            message: "placements deve ser um array não vazio.",
            solution: "Selecione pelo menos um posicionamento.",
          },
          { status: 400 },
        );
      }
      for (const p of targeting.placements) {
        if (!isValidPlacementKey(p)) {
          return NextResponse.json(
            {
              error: "Invalid placement key",
              message: `Posicionamento inválido: ${String(p)}.`,
              solution: "Use apenas os 6 posicionamentos suportados.",
            },
            { status: 400 },
          );
        }
      }
    }

    if (
      !hasDailyBudgetChange &&
      !hasLifetimeBudgetChange &&
      !hasScheduleChange &&
      !hasDeliveryScheduleChange &&
      !hasTargetingChange
    ) {
      return NextResponse.json(
        {
          error: "No changes provided",
          message:
            "At least one of budget, schedule, delivery hours, or targeting must be provided",
          solution:
            "Provide dailyBudget, lifetimeBudget, startTime/endTime, deliveryMode/scheduleBlocks and/or targeting fields to update",
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
      params:
        "fields=id,name,daily_budget,lifetime_budget,start_time,end_time,campaign_id,pacing_type,adset_schedule,targeting",
      accessToken,
    });

    const previousDailyBudget = currentAdSet.daily_budget ?? null;
    const previousLifetimeBudget = currentAdSet.lifetime_budget ?? null;
    const previousStartTime = currentAdSet.start_time ?? null;
    const previousEndTime = currentAdSet.end_time ?? null;
    const previousTargeting = currentAdSet.targeting ?? null;
    const currentCampaign = await metaApiCall<GraphApiCampaign>({
      domain: "FACEBOOK",
      method: "GET",
      path: currentAdSet.campaign_id ?? campaignId ?? "",
      params: "fields=id,daily_budget,lifetime_budget",
      accessToken,
    });
    const usesCBO =
      hasPositiveMinorUnits(currentCampaign.daily_budget) ||
      hasPositiveMinorUnits(currentCampaign.lifetime_budget) ||
      (!hasPositiveMinorUnits(previousDailyBudget) &&
        !hasPositiveMinorUnits(previousLifetimeBudget));
    const hasEffectiveLifetimeBudget =
      hasPositiveMinorUnits(currentCampaign.lifetime_budget) ||
      hasPositiveMinorUnits(previousLifetimeBudget) ||
      hasLifetimeBudgetChange;

    if (hasDailyBudgetChange && hasLifetimeBudgetChange) {
      return NextResponse.json(
        {
          error: "Invalid budget",
          message:
            "Informe apenas um tipo de orçamento: diário ou total.",
          solution:
            "Remova um dos valores de orçamento antes de salvar a alteração.",
        },
        { status: 400 },
      );
    }

    if (hasDailyBudgetChange && dailyBudget < 1) {
      return NextResponse.json(
        {
          error: "Invalid daily budget",
          message: "Orçamento diário deve ser pelo menos R$ 1,00",
          solution: "Informe um orçamento diário válido.",
        },
        { status: 400 },
      );
    }

    if (hasLifetimeBudgetChange && lifetimeBudget < 1) {
      return NextResponse.json(
        {
          error: "Invalid lifetime budget",
          message: "Orçamento total deve ser pelo menos R$ 1,00",
          solution: "Informe um orçamento total válido.",
        },
        { status: 400 },
      );
    }

    const updateParams: Record<string, string> = {};
    const changes: EditAdSetResponse["changes"] = {};

    if (hasDailyBudgetChange || hasLifetimeBudgetChange) {
      if (usesCBO) {
        return NextResponse.json(
          {
            error: "Campaign uses CBO",
            message:
              "Este conjunto de anúncios pertence a uma campanha com Orçamento de Campanha (CBO). O orçamento não pode ser alterado no nível do conjunto de anúncios.",
            solution:
              "Para alterar o orçamento, edite-o diretamente na campanha.",
          },
          { status: 400 },
        );
      }

      if (hasDailyBudgetChange) {
        const budgetInCents = currencyToMinorUnits(dailyBudget);
        updateParams.daily_budget = budgetInCents;
        changes.dailyBudget = {
          previous: previousDailyBudget,
          new: budgetInCents,
        };
      }

      if (hasLifetimeBudgetChange) {
        if (!endTime && !previousEndTime) {
          return NextResponse.json(
            {
              error: "Missing end time",
              message:
                "Orçamento total exige uma data e horário de término para o conjunto de anúncios.",
              solution:
                "Informe a data de término antes de salvar o orçamento total.",
            },
            { status: 400 },
          );
        }

        updateParams.lifetime_budget = currencyToMinorUnits(lifetimeBudget);
      }
    }

    if (hasScheduleChange) {
      if (!hasEffectiveLifetimeBudget) {
        return NextResponse.json(
          {
            error: "Invalid schedule change",
            message:
              "Datas de início e término só podem ser editadas em conjuntos com orçamento total.",
            solution:
              "Altere o tipo de orçamento para total antes de definir um período.",
          },
          { status: 400 },
        );
      }

      const nextStartTime = startTime ?? previousStartTime;
      const nextEndTime = endTime ?? previousEndTime;

      if (!nextStartTime || !nextEndTime) {
        return NextResponse.json(
          {
            error: "Missing schedule",
            message:
              "Informe data e horário de início e término para orçamento total.",
            solution:
              "Preencha os dois campos de período antes de salvar a alteração.",
          },
          { status: 400 },
        );
      }

      if (
        !isValidDateTimeLocal(nextStartTime) ||
        !isValidDateTimeLocal(nextEndTime) ||
        !isEndAfterStart(nextStartTime, nextEndTime)
      ) {
        return NextResponse.json(
          {
            error: "Invalid schedule",
            message: "A data de término deve ser posterior à data de início.",
            solution: "Revise o período informado e tente novamente.",
          },
          { status: 400 },
        );
      }

      if (startTime !== undefined) {
        updateParams.start_time = new Date(startTime).toISOString();
      }
      if (endTime !== undefined) {
        updateParams.end_time = new Date(endTime).toISOString();
      }
    }

    if (hasDeliveryScheduleChange) {
      if (!hasEffectiveLifetimeBudget) {
        return NextResponse.json(
          {
            error: "Invalid delivery schedule change",
            message:
              "A Meta permite editar dias e horarios apenas em conjuntos com orçamento total.",
            solution:
              "Use um conjunto com orçamento total antes de definir dias e horarios.",
          },
          { status: 400 },
        );
      }

      const nextDeliveryMode = deliveryMode ?? "all_day";
      const nextScheduleBlocks =
        nextDeliveryMode === "specific_hours" ? scheduleBlocks : undefined;

      const scheduleValidationError = validateCampaignSchedulePayload({
        startTime: startTime ?? currentAdSet.start_time ?? "",
        endTime: endTime ?? currentAdSet.end_time ?? "",
        deliveryMode: nextDeliveryMode,
        scheduleBlocks: nextScheduleBlocks,
      });

      if (scheduleValidationError) {
        return NextResponse.json(
          {
            error: "Invalid delivery schedule",
            message:
              "Revise os dias e horarios de veiculacao antes de salvar.",
            solution:
              "Use blocos validos, sem sobreposicao, dentro de um periodo ativo com orçamento total.",
          },
          { status: 400 },
        );
      }

      const nextMetaSchedule =
        nextDeliveryMode === "specific_hours"
          ? toMetaAdSetScheduleBlocks(scheduleBlocks)
          : [];
      const nextPacingType =
        nextDeliveryMode === "specific_hours" ? ["day_parting"] : ["standard"];

      updateParams.pacing_type = JSON.stringify(nextPacingType);
      updateParams.adset_schedule = JSON.stringify(nextMetaSchedule);
      const currentLifetimeBudget = currentAdSet.lifetime_budget;
      if (
        nextDeliveryMode === "specific_hours" &&
        hasPositiveMinorUnits(currentLifetimeBudget)
      ) {
        updateParams.lifetime_budget = currentLifetimeBudget;
      }
      const effectiveEndTime = endTime ?? currentAdSet.end_time;
      if (nextDeliveryMode === "specific_hours" && effectiveEndTime) {
        updateParams.end_time = new Date(effectiveEndTime).toISOString();
      }

      changes.deliverySchedule = {
        previousPacingType: currentAdSet.pacing_type,
        newPacingType: nextPacingType,
        previousAdsetSchedule: currentAdSet.adset_schedule,
        newAdsetSchedule: nextMetaSchedule,
      };
    }

    let newTargeting: AdSetTargeting | undefined;
    if (hasTargetingChange) {
      let validatedInterestTargeting:
        | Awaited<ReturnType<typeof validateInterestTargetingForEdit>>
        | undefined;

      if (targeting?.interest_targeting !== undefined) {
        validatedInterestTargeting = await validateInterestTargetingForEdit(
          accessToken,
          targeting.interest_targeting,
          "pt-BR",
        );

        if (!validatedInterestTargeting.ok) {
          return NextResponse.json(
            {
              error: "Invalid interest targeting",
              message: validatedInterestTargeting.message,
              solution:
                "Remova interesses inválidos ou indisponíveis e tente novamente.",
            },
            { status: 400 },
          );
        }
      }

      const prevGeoLocations = previousTargeting?.geo_locations;
      const requestGeoLocations = targeting.geo_locations;

      const newGeoLocations = requestGeoLocations ?? prevGeoLocations;

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

      const prevTargetingAutomation = previousTargeting?.targeting_automation as
        | Record<string, unknown>
        | undefined;

      // Resolve placement fields. If the user submitted new placements, use them;
      // otherwise preserve whatever the ad set had (which might be Advantage+ /
      // automatic placements, i.e. no publisher_platforms at all).
      let placementFields:
        | {
            publisher_platforms: string[];
            facebook_positions?: string[];
            instagram_positions?: string[];
          }
        | null = null;
      if (targeting.placements !== undefined) {
        // Refuse to promote an IG-only ad set to Facebook through edit.
        const prevPlatforms = previousTargeting?.publisher_platforms ?? [];
        const wasInstagramOnly =
          prevPlatforms.length === 1 && prevPlatforms[0] === "instagram";
        if (wasInstagramOnly) {
          const allowed = new Set<PlacementKey>(INSTAGRAM_PLACEMENTS);
          for (const p of targeting.placements) {
            if (!allowed.has(p)) {
              return NextResponse.json(
                {
                  error: "Placement not allowed",
                  message:
                    "Este conjunto de anúncios é Instagram-only. Posicionamentos do Facebook não podem ser ativados aqui.",
                  solution:
                    "Mantenha apenas posicionamentos do Instagram ou refaça a campanha.",
                },
                { status: 400 },
              );
            }
          }
        }
        placementFields = placementsToTargetingFields(targeting.placements);
      }

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
        ...(prevTargetingAutomation && {
          targeting_automation: prevTargetingAutomation,
        }),
        ...(placementFields
          ? placementFields
          : {
              ...(previousTargeting?.publisher_platforms && {
                publisher_platforms: previousTargeting.publisher_platforms,
              }),
              ...(previousTargeting?.facebook_positions && {
                facebook_positions: previousTargeting.facebook_positions,
              }),
              ...(previousTargeting?.instagram_positions && {
                instagram_positions: previousTargeting.instagram_positions,
              }),
            }),
      };

      const metaTargeting: Record<string, unknown> = {
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

      if (targeting.interest_targeting !== undefined && validatedInterestTargeting?.ok) {
        preserveDetailedTargetingFields(previousTargeting, metaTargeting, {
          replaceInterestTargeting: true,
        });
        applyInterestTargetingToMetaTargeting(
          metaTargeting,
          validatedInterestTargeting.value,
          previousTargeting,
        );

        newTargeting = {
          ...newTargeting,
          ...(metaTargeting.flexible_spec !== undefined && {
            flexible_spec: metaTargeting.flexible_spec as AdSetTargeting["flexible_spec"],
          }),
          ...(metaTargeting.exclusions !== undefined && {
            exclusions: metaTargeting.exclusions as AdSetTargeting["exclusions"],
          }),
        };
        if (metaTargeting.flexible_spec === undefined) {
          delete newTargeting.flexible_spec;
        }
        if (metaTargeting.interests === undefined) {
          delete newTargeting.interests;
        }
        if (metaTargeting.exclusions === undefined) {
          delete newTargeting.exclusions;
        }
      }

      const cleanGeo = sanitizeGeoLocationsForMeta(
        metaTargeting.geo_locations as AdSetTargeting["geo_locations"],
      );
      if (cleanGeo) {
        metaTargeting.geo_locations = cleanGeo;
        newTargeting.geo_locations = cleanGeo;
      }

      updateParams.targeting = JSON.stringify(metaTargeting);
      changes.targeting = {
        previous: previousTargeting,
        new: newTargeting,
      };

      // Bake the CONFIRMED Meta business rules locally (reason + suggestion) so a
      // doomed write never reaches their servers: Advantage+ forbids age_max<65
      // (subcode 1870189), and an ad set must target at least one location.
      const effAdvantage = (
        newTargeting.targeting_automation as
          | { advantage_audience?: number | boolean }
          | undefined
      )?.advantage_audience;
      const ruleIssues: CreateIssue[] = [
        ...validateAdvantageAudienceAgeMax({
          advantageAudience: effAdvantage,
          ageMax: newTargeting.age_max,
        }),
        ...validateGeoLocationsPresent(
          newTargeting.geo_locations as Record<string, unknown> | undefined,
        ),
      ];
      if (ruleIssues.length) {
        const first = ruleIssues[0];
        return NextResponse.json(
          {
            error: first.code,
            message: first.reason,
            solution: first.suggestion,
            issues: ruleIssues,
          },
          { status: 400 },
        );
      }
    }

    let appliedToMeta = false;
    let errorMessage: string | undefined;
    let errorStatus = 500;
    let errorSolution: string | undefined;

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
      // Propagate Meta's REAL status (4xx/429/5xx) instead of a blanket 500.
      errorStatus = errorReturn.statusCode;
      errorSolution = errorReturn.reason.solution;
    }

    let logId: string | undefined;
    let auditLogFailed = false;
    let auditLogError: string | undefined;

    try {
      const log = await createAdSetEditLog({
        backofficeUserEmail,
        targetUserId: userId,
        adsetId,
        accountId: accountId.startsWith("act_")
          ? accountId
          : `act_${accountId}`,
        campaignId: campaignId ?? currentAdSet.campaign_id,
        adsetName: adsetName ?? currentAdSet.name,
        previousDailyBudget: previousDailyBudget ?? undefined,
        newDailyBudget: hasDailyBudgetChange
          ? currencyToMinorUnits(dailyBudget)
          : undefined,
        previousLifetimeBudget: previousLifetimeBudget ?? undefined,
        newLifetimeBudget: hasLifetimeBudgetChange
          ? currencyToMinorUnits(lifetimeBudget)
          : undefined,
        previousStartTime:
          hasScheduleChange && previousStartTime ? previousStartTime : undefined,
        newStartTime: startTime ? new Date(startTime).toISOString() : undefined,
        previousEndTime:
          hasScheduleChange && previousEndTime ? previousEndTime : undefined,
        newEndTime: endTime ? new Date(endTime).toISOString() : undefined,
        previousTargeting: previousTargeting ?? undefined,
        newTargeting: newTargeting,
        previousPacingType: hasDeliveryScheduleChange
          ? currentAdSet.pacing_type
          : undefined,
        newPacingType: changes.deliverySchedule?.newPacingType,
        previousAdsetSchedule: hasDeliveryScheduleChange
          ? currentAdSet.adset_schedule
          : undefined,
        newAdsetSchedule: changes.deliverySchedule?.newAdsetSchedule,
        note: note.trim(),
        appliedToMeta,
        errorMessage,
      });
      logId = log.id;
    } catch (dbErr) {
      logMetaMutationError(dbErr);
    console.error(
        "[PATCH adset edit] Failed to write adset_edit_logs:",
        dbErr,
      );
      auditLogFailed = true;
      auditLogError =
        dbErr instanceof Error ? dbErr.message : "Falha ao registrar auditoria";
    }

    if (!appliedToMeta) {
      return NextResponse.json(
        {
          error: "Failed to apply changes to Meta",
          message: errorMessage ?? "Unknown error occurred",
          solution:
            errorSolution ??
            "The change was logged but not applied. Please try again.",
        },
        { status: errorStatus },
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

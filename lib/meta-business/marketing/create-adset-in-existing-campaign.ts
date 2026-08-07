import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import {
  toMetaAdSetScheduleBlocks,
  validateCampaignSchedulePayload,
  type CampaignDeliveryMode,
  type CampaignScheduleBlock,
} from "@/lib/meta-business/campaign-schedule";
import type { GeoLocationsPayload } from "@/lib/meta-business/geo-targeting-types";
import { sanitizeGeoLocationsForMeta } from "@/lib/meta-business/geo-locations";
import type { InterestTargetingValue } from "@/lib/meta-business/interest-targeting-types";
import {
  applyInterestTargetingToMetaTargeting,
  hasInterestTargetingConfigured,
} from "@/lib/meta-business/interest-targeting-types";
import { validateInterestTargetingForWrite } from "@/lib/meta-business/parse-interest-targeting-request";
import {
  DEFAULT_PLACEMENTS_BY_CAMPAIGN_TYPE,
  isValidPlacementKey,
  placementsToTargetingFields,
  type CampaignType,
  type PlacementKey,
} from "@/lib/meta-business/placements";
import {
  AdSetStatus,
  CampaignObjective,
  type GraphApiAdSet,
} from "@/lib/meta-business/types";
import { getPagesWithInstagramAccounts } from "@/lib/meta-business/get-instagram-connected-page";

/**
 * Decides whether this ad set goes out Advantage or strictly manual.
 *
 * Advantage is the default here too — but only when the operator left the
 * audience controls alone.
 *
 * This dialog is the product's manual targeting tool: age, gender, custom
 * audiences, exclusions and interests are meant to be honoured literally, and
 * `advantage_audience: 0` is what makes Meta honour them. Since Marketing API
 * v23.0, combining NON-default values for Age / Gender / Custom Audience
 * Inclusion / Detailed Targeting Inclusion with `advantage_audience: 1` and no
 * declared relaxation is an error — so the flag cannot simply be flipped on.
 *
 * Untouched = Meta's own defaults (18–65, all genders, no audiences, no
 * interests) and no manual placements. In that state the operator expressed no
 * intent, so the ad set goes out Advantage: audience automation on, placement
 * fields omitted entirely.
 *
 * Placements have one extra guard. Instagram-profile traffic stays manual even
 * when everything else is default: Meta does NOT narrow an empty placement set
 * to Instagram — verified live, it stores `publisher_platforms: []` — so
 * automatic placements would let a profile-visit ad set spend on Facebook.
 */
export function resolveAdvantageMode(input: {
  ageMin: number;
  ageMax: number;
  targeting: Pick<
    CreateAdSetTargetingInput,
    | "genders"
    | "custom_audiences"
    | "excluded_custom_audiences"
    | "interest_targeting"
    | "placements"
  >;
  instagramOnlyPlacements?: boolean;
}): { advantageAudience: boolean; advantagePlacements: boolean } {
  const { ageMin, ageMax, targeting, instagramOnlyPlacements } = input;

  const advantageAudience =
    ageMin === 18 &&
    ageMax === 65 &&
    !targeting.genders?.length &&
    !targeting.custom_audiences?.length &&
    !targeting.excluded_custom_audiences?.length &&
    !(
      targeting.interest_targeting &&
      hasInterestTargetingConfigured(targeting.interest_targeting)
    );

  const advantagePlacements =
    advantageAudience &&
    !instagramOnlyPlacements &&
    !(targeting.placements && targeting.placements.length > 0);

  return { advantageAudience, advantagePlacements };
}

export type CreateAdSetTargetingInput = {
  age_min: number;
  age_max: number;
  genders?: number[];
  geo_locations?: GeoLocationsPayload;
  custom_audiences?: { id: string; name?: string }[];
  excluded_custom_audiences?: { id: string; name?: string }[];
  interest_targeting?: InterestTargetingValue;
  placements?: PlacementKey[];
};

export type CreateAdSetInCampaignInput = {
  accountId: string;
  accessToken: string;
  campaignId: string;
  adsetName: string;
  pageId?: string;
  pixelId?: string;
  budgetType?: "daily" | "lifetime";
  budgetValue?: number;
  startTime?: string;
  endTime?: string;
  deliveryMode?: CampaignDeliveryMode;
  scheduleBlocks?: CampaignScheduleBlock[];
  targeting: CreateAdSetTargetingInput;
};

export type CreateAdSetInCampaignSuccess = {
  adsetId: string;
  graphAdSet: GraphApiAdSet;
};

export type CreateAdSetInCampaignError = {
  statusCode: number;
  error: string;
  message: string;
  solution?: string;
};

type GraphApiCampaign = {
  id: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
};

type GraphApiPixel = { id: string; name?: string };
type GraphApiPixelsResponse = { data: GraphApiPixel[] };

type GraphApiAdSetsListResponse = {
  data: Array<{ promoted_object?: { pixel_id?: string } }>;
};

type CreateAdSetApiResponse = { id: string };

type PromotedObjectType =
  | "page"
  | "instagram_traffic"
  | "pixel_conversion";

type OptimizationConfig = {
  optimizationGoal: string;
  billingEvent: string;
  destinationType?: string;
  promotedObjectType: PromotedObjectType;
  instagramOnlyPlacements?: boolean;
  campaignType: CampaignType;
};

export function hasPositiveMinorUnits(
  value: string | null | undefined,
): value is string {
  if (!value) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function getAdSetOptimizationConfig(
  objective?: string,
): OptimizationConfig {
  switch (objective) {
    case CampaignObjective.OUTCOME_LEADS:
    case CampaignObjective.LEAD_GENERATION:
      return {
        optimizationGoal: "LEAD_GENERATION",
        billingEvent: "IMPRESSIONS",
        destinationType: "ON_AD",
        promotedObjectType: "page",
        campaignType: "leads",
      };
    case CampaignObjective.OUTCOME_TRAFFIC:
    case CampaignObjective.LINK_CLICKS:
      return {
        optimizationGoal: "VISIT_INSTAGRAM_PROFILE",
        billingEvent: "IMPRESSIONS",
        destinationType: "INSTAGRAM_PROFILE",
        promotedObjectType: "instagram_traffic",
        instagramOnlyPlacements: true,
        campaignType: "traffic",
      };
    case CampaignObjective.OUTCOME_ENGAGEMENT:
    case CampaignObjective.POST_ENGAGEMENT:
      return {
        optimizationGoal: "POST_ENGAGEMENT",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "page",
        campaignType: "leads",
      };
    case CampaignObjective.OUTCOME_AWARENESS:
    case CampaignObjective.BRAND_AWARENESS:
    case CampaignObjective.REACH:
      return {
        optimizationGoal: "REACH",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "page",
        campaignType: "leads",
      };
    case CampaignObjective.OUTCOME_SALES:
    case CampaignObjective.CONVERSIONS:
      return {
        optimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "pixel_conversion",
        campaignType: "sales",
      };
    case CampaignObjective.VIDEO_VIEWS:
      return {
        optimizationGoal: "THRUPLAY",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "page",
        campaignType: "leads",
      };
    default:
      return {
        optimizationGoal: "REACH",
        billingEvent: "IMPRESSIONS",
        promotedObjectType: "page",
        campaignType: "leads",
      };
  }
}

function isSalesObjective(objective?: string): boolean {
  return (
    objective === CampaignObjective.OUTCOME_SALES ||
    objective === CampaignObjective.CONVERSIONS
  );
}

async function resolvePixelId(params: {
  accessToken: string;
  formattedAccountId: string;
  campaignId: string;
  requestedPixelId?: string;
}): Promise<string | null> {
  if (params.requestedPixelId?.trim()) {
    return params.requestedPixelId.trim();
  }

  try {
    const siblings = await metaApiCall<GraphApiAdSetsListResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${params.formattedAccountId}/adsets`,
      params: `fields=promoted_object&limit=50&filtering=${encodeURIComponent(
        JSON.stringify([
          {
            field: "campaign.id",
            operator: "EQUAL",
            value: params.campaignId,
          },
        ]),
      )}`,
      accessToken: params.accessToken,
    });

    for (const sibling of siblings.data) {
      const inherited = sibling.promoted_object?.pixel_id?.trim();
      if (inherited) return inherited;
    }
  } catch {
    // Fall through to first account pixel.
  }

  const pixelsResponse = await metaApiCall<GraphApiPixelsResponse>({
    domain: "FACEBOOK",
    method: "GET",
    path: `${params.formattedAccountId}/adspixels`,
    params: "fields=id,name&limit=1",
    accessToken: params.accessToken,
  });

  return pixelsResponse.data[0]?.id ?? null;
}

export async function createAdSetInExistingCampaign(
  input: CreateAdSetInCampaignInput,
): Promise<
  | { ok: true; value: CreateAdSetInCampaignSuccess }
  | { ok: false; error: CreateAdSetInCampaignError }
> {
  const {
    accountId,
    accessToken,
    campaignId,
    adsetName,
    pageId,
    pixelId,
    budgetType,
    budgetValue,
    startTime,
    endTime,
    deliveryMode,
    scheduleBlocks,
    targeting,
  } = input;

  const fail = (
    statusCode: number,
    error: string,
    message: string,
    solution?: string,
  ) => ({
    ok: false as const,
    error: { statusCode, error, message, solution },
  });

  if (!campaignId?.trim()) {
    return fail(400, "Missing campaignId", "O ID da campanha é obrigatório.");
  }

  if (!adsetName?.trim()) {
    return fail(
      400,
      "Missing adsetName",
      "Informe um nome para o conjunto de anúncios.",
    );
  }

  const ageMin = targeting.age_min ?? 18;
  const ageMax = targeting.age_max ?? 65;
  if (ageMin < 13 || ageMax > 65 || ageMin > ageMax) {
    return fail(
      400,
      "Invalid age range",
      "A idade deve estar entre 13 e 65, com mínimo menor ou igual ao máximo.",
    );
  }

  if (targeting.placements?.length) {
    for (const placement of targeting.placements) {
      if (!isValidPlacementKey(placement)) {
        return fail(
          400,
          "Invalid placement",
          `Posicionamento inválido: ${String(placement)}.`,
        );
      }
    }
  }

  const formattedAccountId = accountId.startsWith("act_")
    ? accountId
    : `act_${accountId}`;

  let campaign: GraphApiCampaign;
  try {
    campaign = await metaApiCall<GraphApiCampaign>({
      domain: "FACEBOOK",
      method: "GET",
      path: campaignId,
      params: "fields=objective,daily_budget,lifetime_budget,start_time,stop_time",
      accessToken,
    });
  } catch (error) {
    const graphError = errorToGraphErrorReturn(error);
    return fail(
      graphError.statusCode,
      graphError.reason.title,
      graphError.reason.message,
      graphError.reason.solution,
    );
  }

  const campaignObjective = campaign.objective;
  const isCampaignBudgetOptimization =
    hasPositiveMinorUnits(campaign.daily_budget) ||
    hasPositiveMinorUnits(campaign.lifetime_budget);

  if (!isCampaignBudgetOptimization) {
    if (!budgetType || budgetValue === undefined || budgetValue < 1) {
      return fail(
        400,
        "Invalid budget",
        "Informe um orçamento válido de pelo menos R$ 1,00.",
      );
    }

    if (budgetType === "lifetime" && (!startTime || !endTime)) {
      return fail(
        400,
        "Missing schedule dates",
        "Orçamento total exige data de início e término.",
        "Defina o período de veiculação do conjunto.",
      );
    }
  }

  const hasEffectiveLifetimeBudget =
    isCampaignBudgetOptimization &&
    hasPositiveMinorUnits(campaign.lifetime_budget)
      ? true
      : !isCampaignBudgetOptimization && budgetType === "lifetime";

  const effectiveStartTime = isCampaignBudgetOptimization
    ? campaign.start_time ?? ""
    : startTime ?? "";
  const effectiveEndTime = isCampaignBudgetOptimization
    ? campaign.stop_time ?? ""
    : endTime ?? "";

  if (
    deliveryMode === "specific_hours" &&
    !hasEffectiveLifetimeBudget
  ) {
    return fail(
      400,
      "Invalid delivery schedule",
      "Horários específicos só estão disponíveis com orçamento total.",
      "Escolha orçamento total ou use veiculação contínua.",
    );
  }

  if (deliveryMode === "specific_hours") {
    const scheduleValidationError = validateCampaignSchedulePayload({
      startTime: effectiveStartTime,
      endTime: effectiveEndTime,
      deliveryMode: "specific_hours",
      scheduleBlocks,
    });

    if (scheduleValidationError) {
      return fail(
        400,
        "Invalid delivery schedule",
        "Revise os dias e horários de veiculação antes de criar o conjunto.",
        scheduleValidationError,
      );
    }
  }

  const {
    optimizationGoal,
    billingEvent,
    destinationType,
    promotedObjectType,
    instagramOnlyPlacements,
    campaignType,
  } = getAdSetOptimizationConfig(campaignObjective);

  let pagesResponse: Awaited<ReturnType<typeof getPagesWithInstagramAccounts>>;
  try {
    pagesResponse = await getPagesWithInstagramAccounts(accessToken, {
      adAccountId: accountId,
    });
  } catch (error) {
    const graphError = errorToGraphErrorReturn(error);
    return fail(
      graphError.statusCode,
      graphError.reason.title,
      graphError.reason.message,
      graphError.reason.solution,
    );
  }

  const connectedPage = pageId?.trim()
    ? pagesResponse.data.find((page) => page.id === pageId.trim())
    : (pagesResponse.data.find((page) => page.instagram_business_account?.id) ??
      pagesResponse.data[0]);

  if (!connectedPage) {
    return fail(
      400,
      "No Facebook Page found",
      "Nenhuma Página do Facebook encontrada para esta conta Meta.",
      "Conecte uma Página do Facebook e tente novamente.",
    );
  }

  let promotedObject: Record<string, string>;

  if (promotedObjectType === "instagram_traffic") {
    const igAccountId = connectedPage.instagram_business_account?.id;
    if (!igAccountId) {
      return fail(
        400,
        "No Instagram Business Account",
        "Esta campanha de tráfego requer uma conta Instagram Business vinculada à Página.",
        "Conecte o Instagram à Página do Facebook e tente novamente.",
      );
    }
    promotedObject = {
      page_id: connectedPage.id,
      instagram_profile_id: igAccountId,
    };
  } else if (promotedObjectType === "pixel_conversion") {
    const resolvedPixelId = await resolvePixelId({
      accessToken,
      formattedAccountId,
      campaignId,
      requestedPixelId: pixelId,
    });

    if (!resolvedPixelId) {
      return fail(
        400,
        "No Meta Pixel found",
        "Esta campanha de vendas requer um Pixel Meta configurado.",
        "Selecione um pixel ou configure um na conta de anúncios.",
      );
    }

    promotedObject = {
      pixel_id: resolvedPixelId,
      custom_event_type: "PURCHASE",
    };
  } else {
    promotedObject = { page_id: connectedPage.id };
  }

  const defaultPlacements = instagramOnlyPlacements
    ? DEFAULT_PLACEMENTS_BY_CAMPAIGN_TYPE.traffic
    : DEFAULT_PLACEMENTS_BY_CAMPAIGN_TYPE[campaignType];

  const placementKeys =
    targeting.placements && targeting.placements.length > 0
      ? targeting.placements
      : [...defaultPlacements];

  if (instagramOnlyPlacements) {
    const hasFacebookPlacement = placementKeys.some((key) =>
      key.startsWith("facebook_"),
    );
    if (hasFacebookPlacement) {
      return fail(
        400,
        "Invalid placements",
        "Campanhas de tráfego para perfil do Instagram aceitam apenas posicionamentos do Instagram.",
      );
    }
  }

  const geoLocations =
    sanitizeGeoLocationsForMeta(targeting.geo_locations) ??
    ({ countries: ["BR"] } as GeoLocationsPayload);

  const { advantageAudience, advantagePlacements } = resolveAdvantageMode({
    ageMin,
    ageMax,
    targeting,
    instagramOnlyPlacements,
  });
  const usesDefaultAudience = advantageAudience;
  const usesAdvantagePlacements = advantagePlacements;

  const metaTargeting: Record<string, unknown> = {
    geo_locations: geoLocations,
    age_min: ageMin,
    age_max: ageMax,
    ...(usesAdvantagePlacements
      ? {}
      : placementsToTargetingFields(placementKeys)),
    targeting_automation: { advantage_audience: usesDefaultAudience ? 1 : 0 },
    ...(usesDefaultAudience ? {} : { targeting_relaxation_types: { custom_audience: 0 } }),
  };

  if (targeting.genders?.length) {
    metaTargeting.genders = targeting.genders;
  }

  if (targeting.custom_audiences?.length) {
    metaTargeting.custom_audiences = targeting.custom_audiences.map((audience) => ({
      id: audience.id,
    }));
  }

  if (targeting.excluded_custom_audiences?.length) {
    metaTargeting.excluded_custom_audiences =
      targeting.excluded_custom_audiences.map((audience) => ({
        id: audience.id,
      }));
  }

  const interestValidation = await validateInterestTargetingForWrite(
    accessToken,
    targeting.interest_targeting,
    "pt-BR",
  );

  if (!interestValidation.ok) {
    return fail(
      400,
      "Invalid interest targeting",
      interestValidation.message,
      "Remova interesses inválidos ou indisponíveis e tente novamente.",
    );
  }

  applyInterestTargetingToMetaTargeting(metaTargeting, interestValidation.value);

  const adsetParams = new URLSearchParams({
    name: adsetName.trim(),
    campaign_id: campaignId,
    billing_event: billingEvent,
    optimization_goal: optimizationGoal,
    targeting: JSON.stringify(metaTargeting),
    promoted_object: JSON.stringify(promotedObject),
    status: "ACTIVE",
  });

  if (!isCampaignBudgetOptimization) {
    adsetParams.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP");
    const budgetCents = Math.round((budgetValue ?? 0) * 100);
    if (budgetType === "lifetime") {
      adsetParams.set("lifetime_budget", budgetCents.toString());
      if (startTime) adsetParams.set("start_time", startTime);
      if (endTime) adsetParams.set("end_time", endTime);
    } else {
      adsetParams.set("daily_budget", budgetCents.toString());
      adsetParams.set("end_time", "0");
    }
  }

  if (destinationType) {
    adsetParams.set("destination_type", destinationType);
  }

  if (deliveryMode === "specific_hours" && scheduleBlocks?.length) {
    adsetParams.set("pacing_type", JSON.stringify(["day_parting"]));
    adsetParams.set(
      "adset_schedule",
      JSON.stringify(toMetaAdSetScheduleBlocks(scheduleBlocks)),
    );
  }

  let createdAdSet: CreateAdSetApiResponse;
  try {
    createdAdSet = await metaApiCall<CreateAdSetApiResponse>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${formattedAccountId}/adsets`,
      params: "",
      body: adsetParams,
      accessToken,
    });
  } catch (error) {
    const graphError = errorToGraphErrorReturn(error);
    return fail(
      graphError.statusCode,
      graphError.reason.title,
      graphError.reason.message,
      graphError.reason.solution,
    );
  }

  const detailFields = [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign_id",
    "daily_budget",
    "lifetime_budget",
    "budget_remaining",
    "start_time",
    "end_time",
    "created_time",
    "updated_time",
    "optimization_goal",
    "billing_event",
    "bid_amount",
    "is_dynamic_creative",
    "targeting",
    "issues_info{error_code,error_message,error_summary,error_type,level,mid}",
  ].join(",");

  let graphAdSet: GraphApiAdSet;
  try {
    graphAdSet = await metaApiCall<GraphApiAdSet>({
      domain: "FACEBOOK",
      method: "GET",
      path: createdAdSet.id,
      params: `fields=${detailFields}`,
      accessToken,
    });
  } catch {
    graphAdSet = {
      id: createdAdSet.id,
      name: adsetName.trim(),
      campaign_id: campaignId,
      status: AdSetStatus.ACTIVE,
    };
  }

  return {
    ok: true,
    value: {
      adsetId: createdAdSet.id,
      graphAdSet,
    },
  };
}

export function isSalesCampaignObjective(objective?: string): boolean {
  return isSalesObjective(objective);
}

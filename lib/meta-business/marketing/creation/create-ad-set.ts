/**
 * createAdSet — unified Meta ad-set creation primitive (ADR 0009).
 *
 * Same flow as createCampaign: local validation (collect-all) → optional Meta
 * `validate_only` → real create. Covers targeting (geo/age/gender/interests/
 * custom+lookalike audiences/placements/advantage_audience), ABO budget + bid,
 * promoted_object, destination, and dayparting — plus a targeting `raw` and a
 * top-level `extraFields` escape-hatch for anything unmodeled.
 *
 * Endpoint: POST /act_{ad_account_id}/adsets (objeto "Ad Campaign" na doc).
 */

import { metaApiCall } from "@/lib/meta-business/api";
import {
  type CreateIssue,
  type CreateResult,
  type PreviewResult,
  fail,
  localIssue,
  mergeExtraFields,
  ok,
} from "./types";
import { issuesFromError } from "./normalize";
import {
  collect,
  subcodeSuggestion,
  validateAdSetBudget,
  validateBid,
  validateBillingForOptimization,
  validateDayparting,
  validateDestinationForObjective,
  validateOptimizationForObjective,
  validatePlacements,
  validatePromotedObject,
} from "./validation";

export type AdSetTargetingInput = {
  /** Meta geo shape. Defaults to { countries: ["BR"] }. */
  geoLocations?: Record<string, unknown>;
  excludedGeoLocations?: Record<string, unknown>;
  ageMin?: number;
  ageMax?: number;
  /** 1 = male, 2 = female; omit for all. */
  genders?: number[];
  /** Custom audiences (a lookalike is referenced by its id here too). */
  customAudiences?: Array<{ id: string }>;
  excludedCustomAudiences?: Array<{ id: string }>;
  /** AND-of-OR interest/behavior groups (Meta flexible_spec). */
  flexibleSpec?: Array<Record<string, unknown>>;
  /** Manual placements; omit all of these for Advantage+ (automatic) placements. */
  publisherPlatforms?: string[];
  facebookPositions?: string[];
  instagramPositions?: string[];
  audienceNetworkPositions?: string[];
  messengerPositions?: string[];
  devicePlatforms?: string[];
  /** Advantage+ audience. Defaults to true (Meta default). false = strict manual. */
  advantageAudience?: boolean;
  /** Raw merge into the compiled targeting object (escape hatch). */
  raw?: Record<string, unknown>;
};

export type AdSetScheduleInput = {
  mode: "continuous" | "dayparting";
  blocks?: Array<{ days: number[]; startMinute: number; endMinute: number }>;
  /** Defaults to ADVERTISER (account timezone). */
  timezoneType?: "USER" | "ADVERTISER";
};

export type CreateAdSetInput = {
  adAccountId: string;
  accessToken: string;
  campaignId: string;
  name: string;

  /** Parent campaign objective — enables the local objective↔goal↔destination check. */
  objective?: string;
  /** Whether the parent campaign carries the budget (CBO). Defaults to false (ABO). */
  parentUsesCampaignBudget?: boolean;
  /** Whether the parent CBO budget is lifetime (enables dayparting under CBO). */
  parentHasLifetimeBudget?: boolean;

  optimizationGoal: string;
  /** Defaults to IMPRESSIONS (universally accepted). */
  billingEvent?: string;
  destinationType?: string;
  promotedObject?: Record<string, unknown>;

  // ABO budget (ignored when parentUsesCampaignBudget).
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  startTime?: string;
  endTime?: string;

  // ABO bid.
  bidStrategy?: string;
  bidAmountCents?: number;
  roasFloor?: number;

  targeting?: AdSetTargetingInput;
  schedule?: AdSetScheduleInput;

  /** Defaults to PAUSED. */
  status?: "ACTIVE" | "PAUSED";
  /** Escape hatch — merged verbatim into the POST body. */
  extraFields?: Record<string, unknown>;
};

const cents = (n?: number): string | undefined =>
  n != null ? String(Math.round(n)) : undefined;

/** Compile the convenience targeting object into the Meta `targeting` payload. */
export function buildTargeting(t?: AdSetTargetingInput): Record<string, unknown> {
  const tt: Record<string, unknown> = {};
  tt.geo_locations = t?.geoLocations ?? { countries: ["BR"] };
  if (t?.excludedGeoLocations) tt.excluded_geo_locations = t.excludedGeoLocations;
  if (t?.ageMin != null) tt.age_min = t.ageMin;
  if (t?.ageMax != null) tt.age_max = t.ageMax;
  if (t?.genders?.length) tt.genders = t.genders;
  if (t?.customAudiences?.length)
    tt.custom_audiences = t.customAudiences.map((a) => ({ id: a.id }));
  if (t?.excludedCustomAudiences?.length)
    tt.excluded_custom_audiences = t.excludedCustomAudiences.map((a) => ({ id: a.id }));
  if (t?.flexibleSpec?.length) tt.flexible_spec = t.flexibleSpec;
  if (t?.publisherPlatforms?.length) tt.publisher_platforms = t.publisherPlatforms;
  if (t?.facebookPositions?.length) tt.facebook_positions = t.facebookPositions;
  if (t?.instagramPositions?.length) tt.instagram_positions = t.instagramPositions;
  if (t?.audienceNetworkPositions?.length)
    tt.audience_network_positions = t.audienceNetworkPositions;
  if (t?.messengerPositions?.length) tt.messenger_positions = t.messengerPositions;
  if (t?.devicePlatforms?.length) tt.device_platforms = t.devicePlatforms;

  const advantage = t?.advantageAudience !== false; // default true (Meta default)
  tt.targeting_automation = { advantage_audience: advantage ? 1 : 0 };

  const hasManualSignals = Boolean(
    t?.customAudiences?.length ||
      t?.excludedCustomAudiences?.length ||
      t?.genders?.length ||
      t?.ageMin != null ||
      t?.ageMax != null ||
      t?.flexibleSpec?.length,
  );
  if (advantage && hasManualSignals) {
    // advantage_audience:1 with non-default selections must declare relaxation,
    // else Meta errors. Allow expansion (the Advantage+ behaviour).
    tt.targeting_relaxation_types = { lookalike: 1, custom_audience: 1 };
  } else if (!advantage) {
    tt.targeting_relaxation_types = { custom_audience: 0 };
  }

  if (t?.raw) Object.assign(tt, t.raw);
  return tt;
}

function effectiveLifetime(input: CreateAdSetInput): boolean {
  return input.parentUsesCampaignBudget
    ? Boolean(input.parentHasLifetimeBudget)
    : (input.lifetimeBudgetCents ?? 0) > 0;
}

/** Pure local validation (collect-all). No Meta calls. */
export function validateAdSetInput(input: CreateAdSetInput): CreateIssue[] {
  const billingEvent = input.billingEvent ?? "IMPRESSIONS";
  return collect(
    input.name?.trim()
      ? []
      : [localIssue("adset", "NAME_REQUIRED", "O conjunto precisa de um nome.", "Informe um name não vazio.", ["name"])],
    input.campaignId?.trim()
      ? []
      : [localIssue("adset", "CAMPAIGN_ID_REQUIRED", "O conjunto precisa do campaign_id pai.", "Crie a campanha primeiro e passe o id retornado.", ["campaign_id"])],
    input.optimizationGoal?.trim()
      ? []
      : [localIssue("adset", "OPTIMIZATION_GOAL_REQUIRED", "optimization_goal é obrigatório.", "Defina optimization_goal compatível com o objetivo da campanha.", ["optimization_goal"])],
    input.objective ? validateOptimizationForObjective(input.objective, input.optimizationGoal) : [],
    validateBillingForOptimization(input.optimizationGoal, billingEvent),
    input.objective ? validateDestinationForObjective(input.objective, input.destinationType) : [],
    validatePromotedObject({
      optimizationGoal: input.optimizationGoal,
      destinationType: input.destinationType,
      promotedObject: input.promotedObject,
    }),
    validateAdSetBudget({
      parentUsesCampaignBudget: Boolean(input.parentUsesCampaignBudget),
      dailyBudgetCents: input.dailyBudgetCents,
      lifetimeBudgetCents: input.lifetimeBudgetCents,
      hasEndTime: Boolean(input.endTime),
    }),
    input.parentUsesCampaignBudget
      ? []
      : validateBid({
          strategy: input.bidStrategy,
          bidAmountCents: input.bidAmountCents,
          roasFloor: input.roasFloor,
          optimizationGoal: input.optimizationGoal,
        }),
    validateDayparting({
      hasEffectiveLifetimeBudget: effectiveLifetime(input),
      mode: input.schedule?.mode ?? "continuous",
      blocks: input.schedule?.blocks,
    }),
    validatePlacements({
      publisherPlatforms: input.targeting?.publisherPlatforms,
      facebookPositions: input.targeting?.facebookPositions,
      instagramPositions: input.targeting?.instagramPositions,
    }),
  );
}

/** Build the Meta POST body (no access_token — metaApiCall appends it). */
export function buildAdSetPayload(input: CreateAdSetInput): URLSearchParams {
  const p = new URLSearchParams();
  p.set("name", input.name.trim());
  p.set("campaign_id", input.campaignId);
  p.set("optimization_goal", input.optimizationGoal);
  p.set("billing_event", input.billingEvent ?? "IMPRESSIONS");
  p.set("status", input.status ?? "PAUSED");
  p.set("targeting", JSON.stringify(buildTargeting(input.targeting)));
  if (input.destinationType) p.set("destination_type", input.destinationType);
  if (input.promotedObject)
    p.set("promoted_object", JSON.stringify(input.promotedObject));

  // ABO budget + bid live on the ad set (skip entirely under CBO).
  if (!input.parentUsesCampaignBudget) {
    const daily = cents(input.dailyBudgetCents);
    const lifetime = cents(input.lifetimeBudgetCents);
    if (daily) p.set("daily_budget", daily);
    if (lifetime) p.set("lifetime_budget", lifetime);
    // Meta requires a bid_strategy on an ABO ad set (code 100/2490487 if missing);
    // default to automatic lowest cost when the caller didn't choose one.
    p.set("bid_strategy", input.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP");
    const bidAmount = cents(input.bidAmountCents);
    if (bidAmount) p.set("bid_amount", bidAmount);
    if (input.roasFloor != null) {
      p.set(
        "bid_constraints",
        JSON.stringify({ roas_average_floor: Math.round(input.roasFloor * 10000) }),
      );
    }
  }

  if (input.startTime) p.set("start_time", input.startTime);
  if (input.endTime) p.set("end_time", input.endTime);

  if (input.schedule?.mode === "dayparting" && input.schedule.blocks?.length) {
    p.set("pacing_type", JSON.stringify(["day_parting"]));
    p.set(
      "adset_schedule",
      JSON.stringify(
        input.schedule.blocks.map((b) => ({
          days: b.days,
          start_minute: b.startMinute,
          end_minute: b.endMinute,
          timezone_type: input.schedule?.timezoneType ?? "ADVERTISER",
        })),
      ),
    );
  }

  mergeExtraFields(p, input.extraFields);
  return p;
}

function formatAccountId(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

function withValidateOnly(body: URLSearchParams): URLSearchParams {
  const v = new URLSearchParams(body);
  v.set("execution_options", JSON.stringify(["validate_only"]));
  return v;
}

export async function previewAdSet(input: CreateAdSetInput): Promise<PreviewResult> {
  const localIssues = validateAdSetInput(input);
  if (localIssues.length) return { ok: false, issues: localIssues };

  const account = formatAccountId(input.adAccountId);
  const body = buildAdSetPayload(input);
  try {
    await metaApiCall<{ success?: boolean }>({
      method: "POST",
      path: `${account}/adsets`,
      params: "",
      body: withValidateOnly(body),
      accessToken: input.accessToken,
    });
  } catch (error) {
    return {
      ok: false,
      issues: issuesFromError(error, "validate_only", "adset", subcodeSuggestion),
    };
  }
  return { ok: true, payload: Object.fromEntries(body) as Record<string, string> };
}

export async function createAdSet(
  input: CreateAdSetInput,
  opts: { skipRemoteValidation?: boolean } = {},
): Promise<CreateResult> {
  const localIssues = validateAdSetInput(input);
  if (localIssues.length) return fail(localIssues);

  const account = formatAccountId(input.adAccountId);
  const body = buildAdSetPayload(input);

  if (!opts.skipRemoteValidation) {
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: `${account}/adsets`,
        params: "",
        body: withValidateOnly(body),
        accessToken: input.accessToken,
      });
    } catch (error) {
      return fail(issuesFromError(error, "validate_only", "adset", subcodeSuggestion));
    }
  }

  try {
    const res = await metaApiCall<{ id: string }>({
      method: "POST",
      path: `${account}/adsets`,
      params: "",
      body,
      accessToken: input.accessToken,
    });
    return ok(res.id, { id: res.id });
  } catch (error) {
    return fail(issuesFromError(error, "create", "adset", subcodeSuggestion));
  }
}

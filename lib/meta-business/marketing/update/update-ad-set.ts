/**
 * updateAdSet — unified Meta ad-set UPDATE primitive (ADR 0010), sibling of
 * createAdSet. Sparse: only provided fields change. Targeting is MERGED onto the
 * current targeting so untouched nested fields (interests/flexible_spec/
 * exclusions/detailed targeting) are preserved. Budget/schedule/dayparting are
 * validated against the EFFECTIVE state (incl. the parent campaign's budget
 * mode). Provides a `targetingRaw` + `extraFields` escape hatch.
 *
 * Endpoint: POST /{ad_set_id}.
 */

import { metaApiCall } from "@/lib/meta-business/api";
import { localIssue, mergeExtraFields } from "../creation/types";
import { issuesFromError } from "../creation/normalize";
import { sanitizeGeoLocationsForMeta } from "@/lib/meta-business/geo-locations";
import type { AdSetTargeting } from "@/lib/meta-business/types";
import {
  type CreateIssue,
  type PreviewResult,
  type UpdateData,
  type UpdateMode,
  type UpdateResult,
  failUpdate,
  okUpdate,
  withValidateOnly,
} from "./types";
import {
  type AdSetSnapshot,
  parentUsesBudget,
  readAdSet,
} from "./read-current";
import { ensureObjectInAccount } from "./ownership";
import {
  collect,
  endedFlightWarning,
  reviewTriggerWarnings,
  subcodeSuggestion,
  validateAdSetBudgetUpdate,
  validateAdvantageAudienceAgeMax,
  validateBid,
  validateBillingForOptimization,
  validateDayparting,
  validateDestinationForObjective,
  validateGeoLocationsPresent,
  validateOptimizationForObjective,
  validatePlacements,
  validatePromotedObject,
  validateUpdateStatus,
} from "./validation";

/** Partial targeting patch — only provided keys override the current targeting. */
export type AdSetTargetingPatch = {
  geoLocations?: Record<string, unknown>;
  excludedGeoLocations?: Record<string, unknown>;
  ageMin?: number;
  ageMax?: number;
  /** [] clears gender (delivers to all). */
  genders?: number[];
  customAudiences?: Array<{ id: string }>;
  excludedCustomAudiences?: Array<{ id: string }>;
  flexibleSpec?: Array<Record<string, unknown>>;
  publisherPlatforms?: string[];
  facebookPositions?: string[];
  instagramPositions?: string[];
  audienceNetworkPositions?: string[];
  messengerPositions?: string[];
  devicePlatforms?: string[];
  advantageAudience?: boolean;
  /** Merged into the resulting targeting (escape hatch). */
  raw?: Record<string, unknown>;
};

export type AdSetScheduleInput = {
  mode: "continuous" | "dayparting";
  blocks?: Array<{ days: number[]; startMinute: number; endMinute: number }>;
  timezoneType?: "USER" | "ADVERTISER";
};

export type UpdateAdSetInput = {
  adSetId: string;
  accessToken: string;
  /** Account the ad set must belong to (ownership guard, BUG-001 / ADR 0013). */
  adAccountId?: string;

  name?: string;
  status?: string;
  optimizationGoal?: string;
  billingEvent?: string;
  destinationType?: string;
  promotedObject?: Record<string, unknown>;

  /** Providing one budget type REPLACES the other (ABO). */
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  startTime?: string;
  endTime?: string;

  bidStrategy?: string;
  bidAmountCents?: number;
  roasFloor?: number;

  /** Sparse targeting patch (merged onto current). */
  targeting?: AdSetTargetingPatch;
  /** Full Meta targeting object to send verbatim (overrides the patch merge). */
  targetingRaw?: Record<string, unknown>;
  schedule?: AdSetScheduleInput;

  snapshot?: AdSetSnapshot;
  extraFields?: Record<string, unknown>;
};

/**
 * Whether this change needs the current ad set. Targeting MERGE, budget/bid/
 * schedule and the matrix rules all need it; status/name/startTime-only edits
 * don't — so we skip the GET and validate against a minimal snapshot.
 */
function needsCurrentState(input: UpdateAdSetInput): boolean {
  return Boolean(
    input.targeting ||
      input.targetingRaw ||
      input.schedule ||
      input.dailyBudgetCents != null ||
      input.lifetimeBudgetCents != null ||
      input.bidStrategy != null ||
      input.bidAmountCents != null ||
      input.optimizationGoal != null ||
      input.billingEvent != null ||
      input.destinationType != null ||
      input.promotedObject != null ||
      input.endTime != null,
  );
}

async function resolveSnapshot(input: UpdateAdSetInput): Promise<AdSetSnapshot> {
  if (input.snapshot) return input.snapshot;
  if (needsCurrentState(input)) {
    return readAdSet(input.adSetId, input.accessToken);
  }
  return { id: input.adSetId };
}

const cents = (n?: number): string | undefined =>
  n != null ? String(Math.round(n)) : undefined;

const minor = (s?: string): number | undefined => {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Merge a sparse targeting patch onto the current targeting (preserve untouched). */
export function mergeAdSetTargeting(
  current: AdSetTargeting | undefined,
  patch: AdSetTargetingPatch | undefined,
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!patch && !raw) return undefined;
  const t: Record<string, unknown> = current ? clone(current) : {};

  if (patch) {
    if (patch.geoLocations !== undefined) t.geo_locations = patch.geoLocations;
    if (patch.excludedGeoLocations !== undefined)
      t.excluded_geo_locations = patch.excludedGeoLocations;
    if (patch.ageMin !== undefined) t.age_min = patch.ageMin;
    if (patch.ageMax !== undefined) t.age_max = patch.ageMax;
    if (patch.genders !== undefined) {
      if (patch.genders.length) t.genders = patch.genders;
      else delete t.genders;
    }
    if (patch.customAudiences !== undefined)
      t.custom_audiences = patch.customAudiences.map((a) => ({ id: a.id }));
    if (patch.excludedCustomAudiences !== undefined)
      t.excluded_custom_audiences = patch.excludedCustomAudiences.map((a) => ({ id: a.id }));
    if (patch.flexibleSpec !== undefined) t.flexible_spec = patch.flexibleSpec;
    if (patch.publisherPlatforms !== undefined)
      t.publisher_platforms = patch.publisherPlatforms;
    if (patch.facebookPositions !== undefined)
      t.facebook_positions = patch.facebookPositions;
    if (patch.instagramPositions !== undefined)
      t.instagram_positions = patch.instagramPositions;
    if (patch.audienceNetworkPositions !== undefined)
      t.audience_network_positions = patch.audienceNetworkPositions;
    if (patch.messengerPositions !== undefined)
      t.messenger_positions = patch.messengerPositions;
    if (patch.devicePlatforms !== undefined)
      t.device_platforms = patch.devicePlatforms;
    // advantage_audience is PRESERVED from the current targeting (via clone)
    // unless the caller explicitly toggles it. When it IS toggled, mirror the
    // creation builder (create-ad-set.ts): advantage ON + manual signals must
    // declare expansion relaxation; advantage OFF pins custom_audience off.
    if (patch.advantageAudience !== undefined) {
      const on = patch.advantageAudience;
      t.targeting_automation = { advantage_audience: on ? 1 : 0 };
      const hasManualSignals = Boolean(
        (t.custom_audiences as unknown[] | undefined)?.length ||
          (t.excluded_custom_audiences as unknown[] | undefined)?.length ||
          t.age_min != null ||
          t.age_max != null ||
          (t.flexible_spec as unknown[] | undefined)?.length,
      );
      if (on && hasManualSignals) {
        t.targeting_relaxation_types = { lookalike: 1, custom_audience: 1 };
      } else if (!on) {
        t.targeting_relaxation_types = { custom_audience: 0 };
      }
    }
    if (patch.raw) Object.assign(t, patch.raw);
  }

  if (raw) Object.assign(t, raw);

  const cleanGeo = sanitizeGeoLocationsForMeta(t.geo_locations as never);
  if (cleanGeo) t.geo_locations = cleanGeo;

  return t;
}

type EffBudget = { dailyCents?: number; lifetimeCents?: number; touched: boolean };

function effectiveAdSetBudget(input: UpdateAdSetInput, snap: AdSetSnapshot): EffBudget {
  const providedDaily = input.dailyBudgetCents != null;
  const providedLifetime = input.lifetimeBudgetCents != null;
  const touched = providedDaily || providedLifetime;
  const dailyCents = touched
    ? providedDaily
      ? input.dailyBudgetCents
      : 0
    : minor(snap.daily_budget);
  const lifetimeCents = touched
    ? providedLifetime
      ? input.lifetimeBudgetCents
      : 0
    : minor(snap.lifetime_budget);
  return { dailyCents, lifetimeCents, touched };
}

function effectiveLifetime(input: UpdateAdSetInput, snap: AdSetSnapshot, eff: EffBudget): boolean {
  if (parentUsesBudget(snap)) {
    return Number(snap.campaign?.lifetime_budget ?? 0) > 0;
  }
  return (eff.lifetimeCents ?? 0) > 0;
}

/** Pure local validation (collect-all). No Meta calls. */
export function validateUpdateAdSetInput(
  input: UpdateAdSetInput,
  snap: AdSetSnapshot,
): { issues: CreateIssue[]; warnings: CreateIssue[] } {
  const parentCbo = parentUsesBudget(snap);
  const eff = effectiveAdSetBudget(input, snap);
  const objective = snap.campaign?.objective;
  const effOptimization = input.optimizationGoal ?? snap.optimization_goal;
  const effBilling = input.billingEvent ?? snap.billing_event ?? "IMPRESSIONS";
  const effDestination = input.destinationType ?? snap.destination_type;
  const effBidStrategy = input.bidStrategy ?? snap.bid_strategy;

  const touchingMatrix =
    input.optimizationGoal !== undefined ||
    input.billingEvent !== undefined ||
    input.destinationType !== undefined;

  // Validate the EFFECTIVE (merged) targeting that will actually be sent, so the
  // Advantage+ age-cap and geo-presence rules see the post-merge state.
  const effectiveTargeting =
    input.targeting || input.targetingRaw
      ? mergeAdSetTargeting(snap.targeting, input.targeting, input.targetingRaw)
      : undefined;
  const effAdvantage = (
    effectiveTargeting?.targeting_automation as
      | { advantage_audience?: number | boolean }
      | undefined
  )?.advantage_audience;

  const issues = collect(
    input.name !== undefined && !input.name.trim()
      ? [localIssue("adset", "NAME_EMPTY", "O nome do conjunto não pode ser vazio.", "Informe um name não vazio ou não envie o campo.", ["name"])]
      : [],
    validateUpdateStatus("adset", input.status),
    touchingMatrix && objective && effOptimization
      ? validateOptimizationForObjective(objective, effOptimization)
      : [],
    touchingMatrix && effOptimization
      ? validateBillingForOptimization(effOptimization, effBilling)
      : [],
    touchingMatrix && objective
      ? validateDestinationForObjective(objective, effDestination)
      : [],
    input.promotedObject !== undefined || input.optimizationGoal !== undefined
      ? validatePromotedObject({
          optimizationGoal: effOptimization,
          destinationType: effDestination,
          promotedObject: input.promotedObject ?? snap.promoted_object,
        })
      : [],
    validateAdSetBudgetUpdate({
      parentUsesCampaignBudget: parentCbo,
      effectiveDailyCents: eff.dailyCents,
      effectiveLifetimeCents: eff.lifetimeCents,
      effectiveHasEndTime: Boolean(input.endTime ?? snap.end_time),
      budgetTouched: eff.touched,
    }),
    !parentCbo && input.bidStrategy
      ? validateBid({
          strategy: effBidStrategy,
          bidAmountCents: input.bidAmountCents,
          roasFloor: input.roasFloor,
          optimizationGoal: effOptimization,
        })
      : [],
    parentCbo && input.bidStrategy
      ? [localIssue("adset", "BID_STRATEGY_UNDER_CBO", "A campanha usa CBO; a estratégia de lance vive na campanha.", "Ajuste bid_strategy na campanha (updateCampaign) ou migre para ABO.", ["bid_strategy"])]
      : [],
    input.schedule
      ? validateDayparting({
          hasEffectiveLifetimeBudget: effectiveLifetime(input, snap, eff),
          mode: input.schedule.mode,
          blocks: input.schedule.blocks,
        })
      : [],
    input.targeting?.publisherPlatforms ||
    input.targeting?.facebookPositions ||
    input.targeting?.instagramPositions
      ? validatePlacements({
          publisherPlatforms: input.targeting?.publisherPlatforms,
          facebookPositions: input.targeting?.facebookPositions,
          instagramPositions: input.targeting?.instagramPositions,
        })
      : [],
    effectiveTargeting
      ? validateAdvantageAudienceAgeMax({
          advantageAudience: effAdvantage,
          ageMax: effectiveTargeting.age_max as number | undefined,
        })
      : [],
    effectiveTargeting
      ? validateGeoLocationsPresent(
          effectiveTargeting.geo_locations as
            | Record<string, unknown>
            | undefined,
        )
      : [],
  );

  const changed = new Set<string>();
  if (input.targeting || input.targetingRaw) changed.add("targeting");
  if (input.optimizationGoal !== undefined) changed.add("optimization_goal");
  if (input.billingEvent !== undefined) changed.add("billing_event");

  const warnings = collect(
    reviewTriggerWarnings("adset", changed),
    endedFlightWarning({ level: "adset", currentEndTime: snap.end_time, nextEndTime: input.endTime }),
  );

  return { issues, warnings };
}

/** Build the Meta POST body with ONLY the changed fields. */
export function buildAdSetUpdatePayload(
  input: UpdateAdSetInput,
  snap: AdSetSnapshot,
): URLSearchParams {
  const p = new URLSearchParams();
  if (input.name !== undefined) p.set("name", input.name.trim());
  if (input.status !== undefined) p.set("status", input.status);
  if (input.optimizationGoal !== undefined) p.set("optimization_goal", input.optimizationGoal);
  if (input.billingEvent !== undefined) p.set("billing_event", input.billingEvent);
  if (input.destinationType !== undefined) p.set("destination_type", input.destinationType);
  if (input.promotedObject !== undefined)
    p.set("promoted_object", JSON.stringify(input.promotedObject));

  if (!parentUsesBudget(snap)) {
    const daily = cents(input.dailyBudgetCents);
    const lifetime = cents(input.lifetimeBudgetCents);
    if (daily) p.set("daily_budget", daily);
    if (lifetime) p.set("lifetime_budget", lifetime);
    if (input.bidStrategy) {
      p.set("bid_strategy", input.bidStrategy);
      const bidAmount = cents(input.bidAmountCents);
      if (bidAmount) p.set("bid_amount", bidAmount);
      if (input.roasFloor != null) {
        p.set(
          "bid_constraints",
          JSON.stringify({ roas_average_floor: Math.round(input.roasFloor * 10000) }),
        );
      }
    } else {
      const bidAmount = cents(input.bidAmountCents);
      if (bidAmount) p.set("bid_amount", bidAmount);
    }
  }

  if (input.startTime) p.set("start_time", input.startTime);
  if (input.endTime) p.set("end_time", input.endTime);

  const targeting = mergeAdSetTargeting(snap.targeting, input.targeting, input.targetingRaw);
  if (targeting) p.set("targeting", JSON.stringify(targeting));

  if (input.schedule) {
    if (input.schedule.mode === "dayparting" && input.schedule.blocks?.length) {
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
    } else {
      p.set("pacing_type", JSON.stringify(["standard"]));
      p.set("adset_schedule", JSON.stringify([]));
    }
  }

  mergeExtraFields(p, input.extraFields);
  return p;
}

export async function previewUpdateAdSet(
  input: UpdateAdSetInput,
): Promise<PreviewResult> {
  let snap: AdSetSnapshot;
  try {
    snap = await resolveSnapshot(input);
  } catch (error) {
    return { ok: false, issues: issuesFromError(error, "validate_only", "adset", subcodeSuggestion) };
  }

  const ownership = await ensureObjectInAccount({
    objectId: input.adSetId,
    level: "adset",
    expectedAccountId: input.adAccountId,
    snapshotAccountId: snap.account_id,
    accessToken: input.accessToken,
  });
  if (ownership.length) return { ok: false, issues: ownership };

  const { issues, warnings } = validateUpdateAdSetInput(input, snap);
  if (issues.length) return { ok: false, issues };

  const body = buildAdSetUpdatePayload(input, snap);
  try {
    await metaApiCall<{ success?: boolean }>({
      method: "POST",
      path: input.adSetId,
      params: "",
      body: withValidateOnly(body),
      accessToken: input.accessToken,
    });
  } catch (error) {
    return { ok: false, issues: issuesFromError(error, "validate_only", "adset", subcodeSuggestion) };
  }
  return warnings.length
    ? { ok: true, payload: Object.fromEntries(body) as Record<string, string>, warnings }
    : { ok: true, payload: Object.fromEntries(body) as Record<string, string> };
}

export async function updateAdSet(
  input: UpdateAdSetInput,
  opts: { mode?: UpdateMode } = {},
): Promise<UpdateResult> {
  const mode = opts.mode ?? "commit";

  let snap: AdSetSnapshot;
  try {
    snap = await resolveSnapshot(input);
  } catch (error) {
    return failUpdate(issuesFromError(error, "update", "adset", subcodeSuggestion));
  }

  const ownership = await ensureObjectInAccount({
    objectId: input.adSetId,
    level: "adset",
    expectedAccountId: input.adAccountId,
    snapshotAccountId: snap.account_id,
    accessToken: input.accessToken,
  });
  if (ownership.length) return failUpdate(ownership);

  const { issues, warnings } = validateUpdateAdSetInput(input, snap);
  if (issues.length) return failUpdate(issues);

  const body = buildAdSetUpdatePayload(input, snap);

  if (mode !== "commit_unchecked") {
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: input.adSetId,
        params: "",
        body: withValidateOnly(body),
        accessToken: input.accessToken,
      });
    } catch (error) {
      return failUpdate(issuesFromError(error, "validate_only", "adset", subcodeSuggestion));
    }
  }

  const data: UpdateData = { id: input.adSetId, strategy: "update", previousId: input.adSetId };
  if (mode === "preview") return okUpdate(data, warnings);

  try {
    await metaApiCall<{ success?: boolean }>({
      method: "POST",
      path: input.adSetId,
      params: "",
      body,
      accessToken: input.accessToken,
    });
    return okUpdate(data, warnings);
  } catch (error) {
    return failUpdate(issuesFromError(error, "update", "adset", subcodeSuggestion));
  }
}

/**
 * updateCampaign — unified Meta campaign UPDATE primitive (ADR 0010), the
 * single-node sibling of createCampaign. CBO↔ABO mode MIGRATION (multi-object)
 * lives in ./migrate-budget-mode, not here.
 *
 * Flow: read current (or snapshot) → merge sparse change → local validation
 * (collect-all, zero Meta calls on the failure path) → optional Meta
 * `validate_only` → real update. Returns an {@link UpdateResult}; never throws
 * for known/validation failures.
 *
 * Endpoint: POST /{campaign_id} (Ad Campaign Group).
 */

import { metaApiCall } from "@/lib/meta-business/api";
import { mergeExtraFields } from "../creation/types";
import { issuesFromError } from "../creation/normalize";
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
import { type CampaignSnapshot, readCampaign } from "./read-current";
import { ensureObjectInAccount } from "./ownership";
import {
  collect,
  endedFlightWarning,
  subcodeSuggestion,
  validateBid,
  validateCampaignBudgetUpdate,
  validateSpecialAdCategories,
  validateSpecialCategoryTargeting,
  validateUpdateStatus,
} from "./validation";
import { localIssue } from "../creation/types";

export type UpdateCampaignInput = {
  campaignId: string;
  accessToken: string;
  /** Account the campaign must belong to (ownership guard, BUG-001 / ADR 0013). */
  adAccountId?: string;

  /** Only the provided fields change (sparse). */
  name?: string;
  status?: string;
  specialAdCategories?: string[];
  specialAdCategoryCountry?: string[];
  spendCapCents?: number;

  /** Providing one budget type REPLACES the other (CBO budget switch). */
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  startTime?: string;
  stopTime?: string;

  /** Campaign bid (CBO only). */
  bidStrategy?: string;
  bidAmountCents?: number;
  roasFloor?: number;

  /** Pre-fetched current state to skip the GET. */
  snapshot?: CampaignSnapshot;
  /** Escape hatch — merged verbatim into the POST body. */
  extraFields?: Record<string, unknown>;
};

/**
 * Whether validating/merging this change needs the current object. Status/name/
 * spend_cap/special-category/start edits don't — so we skip the GET (saving a
 * call) and validate against a minimal snapshot.
 */
function needsCurrentState(input: UpdateCampaignInput): boolean {
  return (
    input.dailyBudgetCents != null ||
    input.lifetimeBudgetCents != null ||
    input.bidStrategy != null ||
    input.stopTime != null
  );
}

async function resolveSnapshot(input: UpdateCampaignInput): Promise<CampaignSnapshot> {
  if (input.snapshot) return input.snapshot;
  if (needsCurrentState(input)) {
    return readCampaign(input.campaignId, input.accessToken);
  }
  return { id: input.campaignId };
}

const cents = (n?: number): string | undefined =>
  n != null ? String(Math.round(n)) : undefined;

const minor = (s?: string): number | undefined => {
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

type EffectiveBudget = {
  dailyCents?: number;
  lifetimeCents?: number;
  isCbo: boolean;
  hasStopTime: boolean;
};

/** Merge the sparse budget change onto the snapshot (providing one type clears the other). */
function effectiveBudget(
  input: UpdateCampaignInput,
  snap: CampaignSnapshot,
): EffectiveBudget {
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

  return {
    dailyCents,
    lifetimeCents,
    isCbo: (dailyCents ?? 0) > 0 || (lifetimeCents ?? 0) > 0,
    hasStopTime: Boolean(input.stopTime ?? snap.stop_time),
  };
}

/** Pure local validation (collect-all). No Meta calls. */
export function validateUpdateCampaignInput(
  input: UpdateCampaignInput,
  snap: CampaignSnapshot,
): { issues: CreateIssue[]; warnings: CreateIssue[] } {
  const eff = effectiveBudget(input, snap);

  const issues = collect(
    input.name !== undefined && !input.name.trim()
      ? [localIssue("campaign", "NAME_EMPTY", "O nome da campanha não pode ser vazio.", "Informe um name não vazio ou não envie o campo.", ["name"])]
      : [],
    validateUpdateStatus("campaign", input.status),
    validateSpecialAdCategories(input.specialAdCategories),
    validateSpecialCategoryTargeting({
      categories: input.specialAdCategories,
      country: input.specialAdCategoryCountry,
    }),
    validateCampaignBudgetUpdate({
      effectiveDailyCents: eff.dailyCents,
      effectiveLifetimeCents: eff.lifetimeCents,
      effectiveHasStopTime: eff.hasStopTime,
    }),
    eff.isCbo && input.bidStrategy
      ? validateBid({
          strategy: input.bidStrategy,
          bidAmountCents: input.bidAmountCents,
          roasFloor: input.roasFloor,
        })
      : [],
  );

  if (input.bidStrategy && !eff.isCbo) {
    issues.push(
      localIssue(
        "campaign",
        "BID_ON_ABO_CAMPAIGN",
        "bid_strategy na campanha só vale com orçamento de campanha (CBO).",
        "Para ABO, defina bid_strategy/bid_amount no conjunto de anúncios (updateAdSet), não na campanha.",
        ["bid_strategy"],
      ),
    );
  }

  const warnings = endedFlightWarning({
    level: "campaign",
    currentEndTime: snap.stop_time,
    nextEndTime: input.stopTime,
  });

  return { issues, warnings };
}

/** Build the Meta POST body with ONLY the fields the caller is changing. */
export function buildCampaignUpdatePayload(input: UpdateCampaignInput): URLSearchParams {
  const p = new URLSearchParams();
  if (input.name !== undefined) p.set("name", input.name.trim());
  if (input.status !== undefined) p.set("status", input.status);
  if (input.specialAdCategories) {
    p.set("special_ad_categories", JSON.stringify(input.specialAdCategories));
  }
  if (input.specialAdCategoryCountry?.length) {
    p.set("special_ad_category_country", JSON.stringify(input.specialAdCategoryCountry));
  }
  const daily = cents(input.dailyBudgetCents);
  const lifetime = cents(input.lifetimeBudgetCents);
  if (daily) p.set("daily_budget", daily);
  if (lifetime) p.set("lifetime_budget", lifetime);
  const spendCap = cents(input.spendCapCents);
  if (spendCap) p.set("spend_cap", spendCap);
  if (input.startTime) p.set("start_time", input.startTime);
  if (input.stopTime) p.set("stop_time", input.stopTime);

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
  }

  mergeExtraFields(p, input.extraFields);
  return p;
}

export async function previewUpdateCampaign(
  input: UpdateCampaignInput,
): Promise<PreviewResult> {
  let snap: CampaignSnapshot;
  try {
    snap = await resolveSnapshot(input);
  } catch (error) {
    return { ok: false, issues: issuesFromError(error, "validate_only", "campaign", subcodeSuggestion) };
  }

  const ownership = await ensureObjectInAccount({
    objectId: input.campaignId,
    level: "campaign",
    expectedAccountId: input.adAccountId,
    snapshotAccountId: snap.account_id,
    accessToken: input.accessToken,
  });
  if (ownership.length) return { ok: false, issues: ownership };

  const { issues, warnings } = validateUpdateCampaignInput(input, snap);
  if (issues.length) return { ok: false, issues };

  const body = buildCampaignUpdatePayload(input);
  try {
    await metaApiCall<{ success?: boolean }>({
      method: "POST",
      path: input.campaignId,
      params: "",
      body: withValidateOnly(body),
      accessToken: input.accessToken,
    });
  } catch (error) {
    return { ok: false, issues: issuesFromError(error, "validate_only", "campaign", subcodeSuggestion) };
  }
  return warnings.length
    ? { ok: true, payload: Object.fromEntries(body) as Record<string, string>, warnings }
    : { ok: true, payload: Object.fromEntries(body) as Record<string, string> };
}

export async function updateCampaign(
  input: UpdateCampaignInput,
  opts: { mode?: UpdateMode } = {},
): Promise<UpdateResult> {
  const mode = opts.mode ?? "commit";

  let snap: CampaignSnapshot;
  try {
    snap = await resolveSnapshot(input);
  } catch (error) {
    return failUpdate(issuesFromError(error, "update", "campaign", subcodeSuggestion));
  }

  const ownership = await ensureObjectInAccount({
    objectId: input.campaignId,
    level: "campaign",
    expectedAccountId: input.adAccountId,
    snapshotAccountId: snap.account_id,
    accessToken: input.accessToken,
  });
  if (ownership.length) return failUpdate(ownership);

  const { issues, warnings } = validateUpdateCampaignInput(input, snap);
  if (issues.length) return failUpdate(issues);

  const body = buildCampaignUpdatePayload(input);

  if (mode !== "commit_unchecked") {
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: input.campaignId,
        params: "",
        body: withValidateOnly(body),
        accessToken: input.accessToken,
      });
    } catch (error) {
      return failUpdate(issuesFromError(error, "validate_only", "campaign", subcodeSuggestion));
    }
  }

  if (mode === "preview") {
    // previewUpdateCampaign is the dedicated no-write entry; updateCampaign in
    // preview mode just stops here without a result id.
    const data: UpdateData = { id: input.campaignId, strategy: "update", previousId: input.campaignId };
    return okUpdate(data, warnings);
  }

  try {
    await metaApiCall<{ success?: boolean; id?: string }>({
      method: "POST",
      path: input.campaignId,
      params: "",
      body,
      accessToken: input.accessToken,
    });
    const data: UpdateData = { id: input.campaignId, strategy: "update", previousId: input.campaignId };
    return okUpdate(data, warnings);
  } catch (error) {
    return failUpdate(issuesFromError(error, "update", "campaign", subcodeSuggestion));
  }
}

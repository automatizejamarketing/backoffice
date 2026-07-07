/**
 * createCampaign — unified Meta campaign creation primitive (ADR 0009).
 *
 * Flow: local validation (collect-all, zero Meta calls on failure) → optional Meta
 * `validate_only` → real create. Returns a {@link CreateResult}; never throws for
 * known/validation failures. `previewCampaign` runs up to `validate_only` only
 * (the AI assistant's confirm step). Typed common fields + `extraFields`
 * escape-hatch cover any campaign config.
 *
 * Endpoint: POST /act_{ad_account_id}/campaigns (Ad Campaign Group).
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
  validateBid,
  validateCampaignBudget,
  validateObjective,
  validateSpecialAdCategories,
  validateSpecialCategoryTargeting,
} from "./validation";

export type CreateCampaignInput = {
  /** "act_<id>" or a bare numeric id. */
  adAccountId: string;
  accessToken: string;
  name: string;
  /** ODAX objective (OUTCOME_*). */
  objective: string;
  /** Defaults to PAUSED (safe default; pass ACTIVE explicitly to go live). */
  status?: "ACTIVE" | "PAUSED";
  /** Defaults to ["NONE"]. */
  specialAdCategories?: string[];
  /** ISO-2 country codes; required when a real special category is set. */
  specialAdCategoryCountry?: string[];
  /** AUCTION (default, omitted) or RESERVED. */
  buyingType?: string;

  // ── Campaign budget (CBO). Presence here ⇒ CBO; absence ⇒ ABO. ──
  dailyBudgetCents?: number;
  lifetimeBudgetCents?: number;
  spendCapCents?: number;
  startTime?: string; // ISO 8601
  stopTime?: string; // ISO 8601 — required with lifetime budget

  // ── Campaign bid (CBO only). ──
  bidStrategy?: string;
  bidAmountCents?: number;
  /** Human ROAS (e.g. 2.0 = 2×); compiled to bid_constraints.roas_average_floor (×10000). */
  roasFloor?: number;

  /**
   * ABO marker. When there is NO campaign budget, Meta (v24.0+) requires
   * is_adset_budget_sharing_enabled "True"/"False" on the campaign. Set this to
   * declare ABO intent; omit it only if you are setting a campaign budget (CBO).
   */
  isAdsetBudgetSharingEnabled?: boolean;

  /** Escape hatch — merged verbatim into the POST body (any Meta field). */
  extraFields?: Record<string, unknown>;
};

const cents = (n?: number): string | undefined =>
  n != null ? String(Math.round(n)) : undefined;

function usesCampaignBudget(input: CreateCampaignInput): boolean {
  return (input.dailyBudgetCents ?? 0) > 0 || (input.lifetimeBudgetCents ?? 0) > 0;
}

/** Pure local validation (collect-all). No Meta calls. */
export function validateCampaignInput(input: CreateCampaignInput): CreateIssue[] {
  const cbo = usesCampaignBudget(input);
  const issues = collect(
    input.name?.trim()
      ? []
      : [
          localIssue(
            "campaign",
            "NAME_REQUIRED",
            "A campanha precisa de um nome.",
            "Informe um name não vazio.",
            ["name"],
          ),
        ],
    validateObjective(input.objective),
    validateSpecialAdCategories(input.specialAdCategories),
    validateSpecialCategoryTargeting({
      categories: input.specialAdCategories,
      country: input.specialAdCategoryCountry,
    }),
    validateCampaignBudget({
      dailyBudgetCents: input.dailyBudgetCents,
      lifetimeBudgetCents: input.lifetimeBudgetCents,
      hasStopTime: Boolean(input.stopTime),
      isAdsetBudgetSharingEnabledProvided:
        input.isAdsetBudgetSharingEnabled !== undefined,
    }),
    cbo
      ? validateBid({
          strategy: input.bidStrategy,
          bidAmountCents: input.bidAmountCents,
          roasFloor: input.roasFloor,
        })
      : [],
  );

  // A bid strategy on an ABO campaign is silently ignored by Meta (it belongs on
  // the ad set) — flag it so the caller moves it rather than wondering why it
  // had no effect.
  if (input.bidStrategy && !cbo) {
    issues.push(
      localIssue(
        "campaign",
        "BID_ON_ABO_CAMPAIGN",
        "bid_strategy na campanha só vale com orçamento de campanha (CBO).",
        "Para ABO, defina bid_strategy/bid_amount no conjunto de anúncios, não na campanha.",
        ["bid_strategy"],
      ),
    );
  }

  return issues;
}

/** Build the Meta POST body (no access_token — metaApiCall appends it). */
export function buildCampaignPayload(input: CreateCampaignInput): URLSearchParams {
  const p = new URLSearchParams();
  p.set("name", input.name.trim());
  p.set("objective", input.objective);
  p.set("status", input.status ?? "PAUSED");
  p.set(
    "special_ad_categories",
    JSON.stringify(input.specialAdCategories ?? ["NONE"]),
  );
  if (input.specialAdCategoryCountry?.length) {
    p.set(
      "special_ad_category_country",
      JSON.stringify(input.specialAdCategoryCountry),
    );
  }
  if (input.buyingType) p.set("buying_type", input.buyingType);

  const daily = cents(input.dailyBudgetCents);
  const lifetime = cents(input.lifetimeBudgetCents);
  if (daily) p.set("daily_budget", daily);
  if (lifetime) p.set("lifetime_budget", lifetime);
  const spendCap = cents(input.spendCapCents);
  if (spendCap) p.set("spend_cap", spendCap);
  if (input.startTime) p.set("start_time", input.startTime);
  if (input.stopTime) p.set("stop_time", input.stopTime);

  const cbo = Boolean(daily || lifetime);
  if (cbo && input.bidStrategy) {
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

  // ABO (no campaign budget): Meta requires the explicit flag (v24.0+).
  if (!cbo && input.isAdsetBudgetSharingEnabled !== undefined) {
    p.set(
      "is_adset_budget_sharing_enabled",
      input.isAdsetBudgetSharingEnabled ? "True" : "False",
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

/**
 * Run local validation + Meta `validate_only` WITHOUT creating anything. This is
 * the AI assistant's preview/confirm step (ADR 0009). Returns the compiled
 * payload that would be sent, or the issues that block it.
 */
export async function previewCampaign(
  input: CreateCampaignInput,
): Promise<PreviewResult> {
  const localIssues = validateCampaignInput(input);
  if (localIssues.length) return { ok: false, issues: localIssues };

  const account = formatAccountId(input.adAccountId);
  const body = buildCampaignPayload(input);
  try {
    await metaApiCall<{ success?: boolean }>({
      method: "POST",
      path: `${account}/campaigns`,
      params: "",
      body: withValidateOnly(body),
      accessToken: input.accessToken,
    });
  } catch (error) {
    return {
      ok: false,
      issues: issuesFromError(error, "validate_only", "campaign", subcodeSuggestion),
    };
  }
  return { ok: true, payload: Object.fromEntries(body) as Record<string, string> };
}

/**
 * Create the campaign: local validation → (Meta `validate_only` unless
 * `skipRemoteValidation`) → real create. Always returns a {@link CreateResult}.
 */
export async function createCampaign(
  input: CreateCampaignInput,
  opts: { skipRemoteValidation?: boolean } = {},
): Promise<CreateResult> {
  const localIssues = validateCampaignInput(input);
  if (localIssues.length) return fail(localIssues);

  const account = formatAccountId(input.adAccountId);
  const body = buildCampaignPayload(input);

  if (!opts.skipRemoteValidation) {
    try {
      await metaApiCall<{ success?: boolean }>({
        method: "POST",
        path: `${account}/campaigns`,
        params: "",
        body: withValidateOnly(body),
        accessToken: input.accessToken,
      });
    } catch (error) {
      return fail(
        issuesFromError(error, "validate_only", "campaign", subcodeSuggestion),
      );
    }
  }

  try {
    const res = await metaApiCall<{ id: string }>({
      method: "POST",
      path: `${account}/campaigns`,
      params: "",
      body,
      accessToken: input.accessToken,
    });
    return ok(res.id, { id: res.id });
  } catch (error) {
    return fail(issuesFromError(error, "create", "campaign", subcodeSuggestion));
  }
}

// Pure helpers for parsing Meta Marketing API insights.
// MIRROR of automatize-frontend/lib/meta-business/marketing/insights.ts — kept in
// sync so the backoffice on-demand refresh extracts the exact same metrics as the
// frontend cron. actions/action_values/purchase_roas come back as arrays of
// `{ action_type, value }`; the right value depends on matching action types.

import type { GraphApiInsights, InsightsMetrics } from "@/lib/meta-business/types";

export const PURCHASE_ACTION_TYPES = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
] as const;

export const LEAD_ACTION_TYPES = [
  "lead",
  "complete_registration",
  "onsite_conversion.lead_grouped",
] as const;

export const LINK_CLICK_ACTION_TYPES = ["link_click"] as const;

export const LANDING_PAGE_VIEW_ACTION_TYPES = [
  "landing_page_view",
  "onsite_conversion.landing_page_view",
] as const;

export function getActionValue(
  actions:
    | GraphApiInsights["actions"]
    | GraphApiInsights["cost_per_action_type"]
    | GraphApiInsights["action_values"]
    | GraphApiInsights["purchase_roas"]
    | GraphApiInsights["website_purchase_roas"],
  actionTypes: readonly string[],
): string | undefined {
  if (!actions) return undefined;

  const matchingAction = actions.find((action) =>
    actionTypes.includes(action.action_type),
  );

  return matchingAction?.value;
}

/**
 * Transforms Graph API insights to camelCase InsightsMetrics. Accepts the
 * `{ data: [...] }` envelope and reads the first row, so the on-demand refresh
 * can call it per account-level row via `transformInsights({ data: [row] })`.
 */
export function transformInsights(insights?: {
  data: GraphApiInsights[];
}): InsightsMetrics | undefined {
  if (!insights?.data?.[0]) return undefined;

  const data = insights.data[0];

  const purchaseCount = getActionValue(data.actions, PURCHASE_ACTION_TYPES);
  const purchaseCost = getActionValue(
    data.cost_per_action_type,
    PURCHASE_ACTION_TYPES,
  );
  const purchaseValue = getActionValue(data.action_values, PURCHASE_ACTION_TYPES);
  const purchaseRoas =
    getActionValue(data.purchase_roas, PURCHASE_ACTION_TYPES) ??
    getActionValue(data.purchase_roas, ["omni_purchase"]);
  const websitePurchaseRoas =
    getActionValue(data.website_purchase_roas, PURCHASE_ACTION_TYPES) ??
    getActionValue(data.website_purchase_roas, ["omni_purchase"]);
  const linkClicks = getActionValue(data.actions, LINK_CLICK_ACTION_TYPES);
  const landingPageViews = getActionValue(
    data.actions,
    LANDING_PAGE_VIEW_ACTION_TYPES,
  );
  const leadCount = getActionValue(data.actions, LEAD_ACTION_TYPES);
  const leadCost = getActionValue(data.cost_per_action_type, LEAD_ACTION_TYPES);
  const conversions = purchaseCount ?? leadCount;
  const costPerConversion = purchaseCost ?? leadCost;

  return {
    spend: data.spend,
    impressions: data.impressions,
    clicks: data.clicks,
    reach: data.reach,
    cpc: data.cpc,
    cpm: data.cpm,
    ctr: data.ctr,
    cpp: data.cpp,
    frequency: data.frequency,
    conversions,
    costPerConversion,
    purchaseCount,
    purchaseCost,
    purchaseValue,
    purchaseRoas,
    websitePurchaseRoas,
    linkClicks,
    landingPageViews,
    leadCount,
    leadCost,
    dateStart: data.date_start,
    dateStop: data.date_stop,
  };
}

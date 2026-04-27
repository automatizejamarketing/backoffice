import type {
  GraphApiInsights,
  GraphApiCampaign,
  GraphApiAdSet,
  GraphApiAd,
  GraphPaging,
  InsightsMetrics,
  Campaign,
  AdSet,
  Ad,
  PaginationInfo,
} from "./types";

const PURCHASE_ACTION_TYPES = [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
] as const;

const LEAD_ACTION_TYPES = [
  "lead",
  "complete_registration",
  "onsite_conversion.lead_grouped",
] as const;

const LINK_CLICK_ACTION_TYPES = ["link_click"] as const;

const LANDING_PAGE_VIEW_ACTION_TYPES = [
  "landing_page_view",
  "onsite_conversion.landing_page_view",
] as const;

function getActionValue(
  actions: GraphApiInsights["actions"] | GraphApiInsights["cost_per_action_type"] | GraphApiInsights["action_values"] | GraphApiInsights["purchase_roas"] | GraphApiInsights["website_purchase_roas"],
  actionTypes: readonly string[],
): string | undefined {
  if (!actions) return undefined;

  const matchingAction = actions.find((action) =>
    actionTypes.includes(action.action_type),
  );

  return matchingAction?.value;
}

/**
 * Transforms Graph API insights to camelCase InsightsMetrics.
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

/**
 * Transforms Graph API campaign to camelCase Campaign.
 */
export function transformCampaign(campaign: GraphApiCampaign): Campaign {
  const usesCampaignBudget = !!(
    campaign.daily_budget || campaign.lifetime_budget
  );

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    effectiveStatus: campaign.effective_status,
    objective: campaign.objective,
    dailyBudget: campaign.daily_budget,
    lifetimeBudget: campaign.lifetime_budget,
    budgetRemaining: campaign.budget_remaining,
    budgetMode: usesCampaignBudget ? "CBO" : "ABO",
    usesCampaignBudget,
    isAdsetBudgetSharingEnabled: campaign.is_adset_budget_sharing_enabled,
    startTime: campaign.start_time,
    stopTime: campaign.stop_time,
    createdTime: campaign.created_time,
    updatedTime: campaign.updated_time,
    insights: transformInsights(campaign.insights),
  };
}

/**
 * Transforms Graph API ad set to camelCase AdSet.
 */
export function transformAdSet(adSet: GraphApiAdSet): AdSet {
  return {
    id: adSet.id,
    name: adSet.name,
    status: adSet.status,
    effectiveStatus: adSet.effective_status,
    campaignId: adSet.campaign_id,
    dailyBudget: adSet.daily_budget,
    lifetimeBudget: adSet.lifetime_budget,
    budgetRemaining: adSet.budget_remaining,
    startTime: adSet.start_time,
    endTime: adSet.end_time,
    createdTime: adSet.created_time,
    updatedTime: adSet.updated_time,
    optimizationGoal: adSet.optimization_goal,
    billingEvent: adSet.billing_event,
    bidAmount: adSet.bid_amount,
    targeting: adSet.targeting,
    insights: transformInsights(adSet.insights),
  };
}

/**
 * Transforms Graph API ad to camelCase Ad.
 */
export function transformAd(ad: GraphApiAd): Ad {
  return {
    id: ad.id,
    name: ad.name,
    status: ad.status,
    effectiveStatus: ad.effective_status,
    adsetId: ad.adset_id,
    campaignId: ad.campaign_id,
    createdTime: ad.created_time,
    updatedTime: ad.updated_time,
    creative: ad.creative
      ? {
          id: ad.creative.id,
          name: ad.creative.name,
          title: ad.creative.title,
          body: ad.creative.body,
          imageUrl: ad.creative.image_url,
          thumbnailUrl: ad.creative.thumbnail_url,
          effectiveObjectStoryId: ad.creative.effective_object_story_id,
        }
      : undefined,
    insights: transformInsights(ad.insights),
  };
}

/**
 * Transforms Graph API paging to PaginationInfo.
 */
export function transformPaging(paging?: GraphPaging): PaginationInfo {
  return {
    hasNextPage: !!paging?.next,
    hasPreviousPage: !!paging?.previous,
    nextCursor: paging?.cursors?.after,
    previousCursor: paging?.cursors?.before,
  };
}

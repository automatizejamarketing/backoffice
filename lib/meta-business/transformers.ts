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

/**
 * Transforms Graph API insights to camelCase InsightsMetrics.
 */
export function transformInsights(insights?: {
  data: GraphApiInsights[];
}): InsightsMetrics | undefined {
  if (!insights?.data?.[0]) return undefined;

  const data = insights.data[0];

  // Find conversions and cost per conversion from actions
  let conversions: string | undefined;
  let costPerConversion: string | undefined;

  if (data.actions) {
    const conversionAction = data.actions.find(
      (a) =>
        a.action_type === "purchase" ||
        a.action_type === "lead" ||
        a.action_type === "complete_registration"
    );
    if (conversionAction) {
      conversions = conversionAction.value;
    }
  }

  if (data.cost_per_action_type) {
    const costAction = data.cost_per_action_type.find(
      (a) =>
        a.action_type === "purchase" ||
        a.action_type === "lead" ||
        a.action_type === "complete_registration"
    );
    if (costAction) {
      costPerConversion = costAction.value;
    }
  }

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
    dateStart: data.date_start,
    dateStop: data.date_stop,
  };
}

/**
 * Transforms Graph API campaign to camelCase Campaign.
 */
export function transformCampaign(campaign: GraphApiCampaign): Campaign {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    effectiveStatus: campaign.effective_status,
    objective: campaign.objective,
    dailyBudget: campaign.daily_budget,
    lifetimeBudget: campaign.lifetime_budget,
    budgetRemaining: campaign.budget_remaining,
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

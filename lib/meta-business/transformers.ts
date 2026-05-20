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
  AdIssue,
  AdReviewFeedback,
  DescendantIssuesCounts,
  EffectiveStatus,
  GraphApiAdIssuesInfo,
  GraphApiAdReviewFeedback,
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
 * Transforms a Meta `issues_info` array into camelCase. Returns `undefined`
 * when the input is missing or empty so callers can rely on a strict
 * "no field" === "no issues" contract.
 */
export function transformAdIssues(
  issues?: GraphApiAdIssuesInfo[],
): AdIssue[] | undefined {
  if (!issues || issues.length === 0) return undefined;
  return issues.map((issue) => ({
    errorCode: issue.error_code,
    errorMessage: issue.error_message,
    errorSummary: issue.error_summary,
    errorType: issue.error_type,
    level: issue.level,
    mid: issue.mid,
  }));
}

/**
 * Transforms Meta `ad_review_feedback` snake_case → camelCase. Returns
 * `undefined` when the input is missing.
 */
export function transformAdReviewFeedback(
  feedback?: GraphApiAdReviewFeedback,
): AdReviewFeedback | undefined {
  if (!feedback) return undefined;
  return {
    global: feedback.global,
    placementSpecific: feedback.placement_specific,
  };
}

/**
 * Counts how many descendant items (ad sets or ads) Meta marked as
 * `WITH_ISSUES` or `DISAPPROVED`. Returns `undefined` when no descendants
 * were returned (so we don't lie that "0 have issues" when we just didn't
 * fetch them).
 */
export function countDescendantIssues(
  items: Array<{ effective_status?: EffectiveStatus | string }> | undefined,
): DescendantIssuesCounts | undefined {
  if (!items) return undefined;
  let withIssues = 0;
  let disapproved = 0;
  for (const item of items) {
    if (item.effective_status === "WITH_ISSUES") withIssues++;
    else if (item.effective_status === "DISAPPROVED") disapproved++;
  }
  return { withIssues, disapproved };
}

/**
 * Transforms Graph API campaign to camelCase Campaign.
 */
export function transformCampaign(campaign: GraphApiCampaign): Campaign {
  const usesCampaignBudget = !!(
    campaign.daily_budget || campaign.lifetime_budget
  );

  const adSetsSummary = countDescendantIssues(campaign.adsets?.data);
  const adsSummary = countDescendantIssues(campaign.ads?.data);
  const issuesSummary =
    adSetsSummary || adsSummary
      ? {
          ...(adSetsSummary && { adSets: adSetsSummary }),
          ...(adsSummary && { ads: adsSummary }),
        }
      : undefined;

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
    isAdsetBudgetSharingEnabled: transformMetaBoolean(
      campaign.is_adset_budget_sharing_enabled,
    ),
    startTime: campaign.start_time,
    stopTime: campaign.stop_time,
    createdTime: campaign.created_time,
    updatedTime: campaign.updated_time,
    insights: transformInsights(campaign.insights),
    issues: transformAdIssues(campaign.issues_info),
    issuesSummary,
  };
}

function transformMetaBoolean(value: boolean | string | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }

  return undefined;
}

/**
 * Transforms Graph API ad set to camelCase AdSet.
 */
export function transformAdSet(adSet: GraphApiAdSet): AdSet {
  const adsSummary = countDescendantIssues(adSet.ads?.data);
  const issuesSummary = adsSummary ? { ads: adsSummary } : undefined;

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
    bidStrategy: adSet.bid_strategy,
    destinationType: adSet.destination_type,
    promotedObject: adSet.promoted_object,
    isDynamicCreative: adSet.is_dynamic_creative === true,
    targeting: adSet.targeting,
    targetingSentenceLines: adSet.targetingsentencelines?.data,
    pacingType: adSet.pacing_type,
    adsetSchedule: adSet.adset_schedule,
    campaign: adSet.campaign
      ? {
          ...transformCampaign(adSet.campaign),
          isAdsetBudgetSharingEnabled: transformMetaBoolean(
            adSet.campaign.is_adset_budget_sharing_enabled,
          ),
        }
      : undefined,
    insights: transformInsights(adSet.insights),
    issues: transformAdIssues(adSet.issues_info),
    issuesSummary,
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
    issues: transformAdIssues(ad.issues_info),
    reviewFeedback: transformAdReviewFeedback(ad.ad_review_feedback),
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

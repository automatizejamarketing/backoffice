/**
 * Status of the account.
 *
 * 1 = ACTIVE
 * 2 = DISABLED
 * 3 = UNSETTLED
 * 7 = PENDING_RISK_REVIEW
 * 8 = PENDING_SETTLEMENT
 * 9 = IN_GRACE_PERIOD
 * 100 = PENDING_CLOSURE
 * 101 = CLOSED
 * 201 = ANY_ACTIVE
 * 202 = ANY_CLOSED
 */
export enum AccountStatus {
  ACTIVE = 1,
  DISABLED = 2,
  UNSETTLED = 3,
  PENDING_RISK_REVIEW = 7,
  PENDING_SETTLEMENT = 8,
  IN_GRACE_PERIOD = 9,
  PENDING_CLOSURE = 100,
  CLOSED = 101,
  ANY_ACTIVE = 201,
  ANY_CLOSED = 202,
}

export enum CampaignObjective {
  APP_INSTALLS = "APP_INSTALLS",
  BRAND_AWARENESS = "BRAND_AWARENESS",
  CONVERSIONS = "CONVERSIONS",
  EVENT_RESPONSES = "EVENT_RESPONSES",
  LEAD_GENERATION = "LEAD_GENERATION",
  LINK_CLICKS = "LINK_CLICKS",
  LOCAL_AWARENESS = "LOCAL_AWARENESS",
  MESSAGES = "MESSAGES",
  OFFER_CLAIMS = "OFFER_CLAIMS",
  OUTCOME_APP_PROMOTION = "OUTCOME_APP_PROMOTION",
  OUTCOME_AWARENESS = "OUTCOME_AWARENESS",
  OUTCOME_ENGAGEMENT = "OUTCOME_ENGAGEMENT",
  OUTCOME_LEADS = "OUTCOME_LEADS",
  OUTCOME_SALES = "OUTCOME_SALES",
  OUTCOME_TRAFFIC = "OUTCOME_TRAFFIC",
  PAGE_LIKES = "PAGE_LIKES",
  POST_ENGAGEMENT = "POST_ENGAGEMENT",
  PRODUCT_CATALOG_SALES = "PRODUCT_CATALOG_SALES",
  REACH = "REACH",
  STORE_VISITS = "STORE_VISITS",
  VIDEO_VIEWS = "VIDEO_VIEWS",
}

export enum DatePreset {
  TODAY = "today",
  YESTERDAY = "yesterday",
  THIS_MONTH = "this_month",
  LAST_MONTH = "last_month",
  THIS_QUARTER = "this_quarter",
  MAXIMUM = "maximum",
  DATA_MAXIMUM = "data_maximum",
  LAST_3D = "last_3d",
  LAST_7D = "last_7d",
  LAST_14D = "last_14d",
  LAST_28D = "last_28d",
  LAST_30D = "last_30d",
  LAST_90D = "last_90d",
  LAST_WEEK_MON_SUN = "last_week_mon_sun",
  LAST_WEEK_SUN_SAT = "last_week_sun_sat",
  LAST_QUARTER = "last_quarter",
  LAST_YEAR = "last_year",
  THIS_WEEK_MON_TODAY = "this_week_mon_today",
  THIS_WEEK_SUN_TODAY = "this_week_sun_today",
  THIS_YEAR = "this_year",
}

/**
 * Status of a campaign.
 */
export enum CampaignStatus {
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  DELETED = "DELETED",
  ARCHIVED = "ARCHIVED",
}

/**
 * Status of an ad set.
 */
export enum AdSetStatus {
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  DELETED = "DELETED",
  ARCHIVED = "ARCHIVED",
}

/**
 * Status of an ad.
 */
export enum AdStatus {
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  DELETED = "DELETED",
  ARCHIVED = "ARCHIVED",
}

/**
 * Effective status represents the actual delivery status
 * considering parent object status and other factors.
 */
export enum EffectiveStatus {
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  DELETED = "DELETED",
  PENDING_REVIEW = "PENDING_REVIEW",
  DISAPPROVED = "DISAPPROVED",
  PREAPPROVED = "PREAPPROVED",
  PENDING_BILLING_INFO = "PENDING_BILLING_INFO",
  CAMPAIGN_PAUSED = "CAMPAIGN_PAUSED",
  ARCHIVED = "ARCHIVED",
  ADSET_PAUSED = "ADSET_PAUSED",
  IN_PROCESS = "IN_PROCESS",
  WITH_ISSUES = "WITH_ISSUES",
}

// ================================
// Pagination Types
// ================================

/**
 * Cursor-based pagination from Graph API.
 */
export type GraphPagingCursors = {
  before?: string;
  after?: string;
};

export type GraphPaging = {
  cursors?: GraphPagingCursors;
  next?: string;
  previous?: string;
};

/**
 * Pagination info in camelCase for API responses.
 */
export type PaginationInfo = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextCursor?: string;
  previousCursor?: string;
};

// ================================
// Time Range Types
// ================================

/**
 * Custom time range for insights queries.
 * Dates should be in YYYY-MM-DD format.
 */
export type TimeRange = {
  since: string;
  until: string;
};

// ================================
// Insights Types
// ================================

/**
 * Graph API insights response (snake_case).
 */
export type GraphApiInsights = {
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  cpp?: string;
  frequency?: string;
  actions?: Array<{
    action_type: string;
    value: string;
  }>;
  cost_per_action_type?: Array<{
    action_type: string;
    value: string;
  }>;
  date_start?: string;
  date_stop?: string;
};

/**
 * Insights metrics in camelCase for API responses.
 */
export type InsightsMetrics = {
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  cpp?: string;
  frequency?: string;
  conversions?: string;
  costPerConversion?: string;
  dateStart?: string;
  dateStop?: string;
};

// ================================
// Campaign Types
// ================================

/**
 * Graph API campaign response (snake_case).
 */
export type GraphApiCampaign = {
  id: string;
  name?: string;
  status?: CampaignStatus;
  effective_status?: EffectiveStatus;
  objective?: CampaignObjective;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
  insights?: {
    data: GraphApiInsights[];
  };
  adsets?: {
    data: GraphApiAdSet[];
    paging?: GraphPaging;
  };
};

/**
 * Campaign in camelCase for API responses.
 */
export type Campaign = {
  id: string;
  name?: string;
  status?: CampaignStatus;
  effectiveStatus?: EffectiveStatus;
  objective?: CampaignObjective;
  dailyBudget?: string;
  lifetimeBudget?: string;
  budgetRemaining?: string;
  startTime?: string;
  stopTime?: string;
  createdTime?: string;
  updatedTime?: string;
  insights?: InsightsMetrics;
};

// ================================
// Ad Set Types
// ================================

/**
 * Graph API ad set response (snake_case).
 */
export type GraphApiAdSet = {
  id: string;
  name?: string;
  status?: AdSetStatus;
  effective_status?: EffectiveStatus;
  campaign_id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  start_time?: string;
  end_time?: string;
  created_time?: string;
  updated_time?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_amount?: string;
  insights?: {
    data: GraphApiInsights[];
  };
  ads?: {
    data: GraphApiAd[];
    paging?: GraphPaging;
  };
};

/**
 * Ad Set in camelCase for API responses.
 */
export type AdSet = {
  id: string;
  name?: string;
  status?: AdSetStatus;
  effectiveStatus?: EffectiveStatus;
  campaignId?: string;
  dailyBudget?: string;
  lifetimeBudget?: string;
  budgetRemaining?: string;
  startTime?: string;
  endTime?: string;
  createdTime?: string;
  updatedTime?: string;
  optimizationGoal?: string;
  billingEvent?: string;
  bidAmount?: string;
  insights?: InsightsMetrics;
};

// ================================
// Ad Types
// ================================

/**
 * Graph API ad response (snake_case).
 */
export type GraphApiAd = {
  id: string;
  name?: string;
  status?: AdStatus;
  effective_status?: EffectiveStatus;
  adset_id?: string;
  campaign_id?: string;
  created_time?: string;
  updated_time?: string;
  creative?: {
    id: string;
    name?: string;
    title?: string;
    body?: string;
    image_url?: string;
    thumbnail_url?: string;
    effective_object_story_id?: string;
  };
  insights?: {
    data: GraphApiInsights[];
  };
};

/**
 * Ad Creative in camelCase.
 */
export type AdCreative = {
  id: string;
  name?: string;
  title?: string;
  body?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  effectiveObjectStoryId?: string;
};

/**
 * Ad in camelCase for API responses.
 */
export type Ad = {
  id: string;
  name?: string;
  status?: AdStatus;
  effectiveStatus?: EffectiveStatus;
  adsetId?: string;
  campaignId?: string;
  createdTime?: string;
  updatedTime?: string;
  creative?: AdCreative;
  insights?: InsightsMetrics;
};

export type TimeIncrement = "day" | "week" | "month" | "quarterly";

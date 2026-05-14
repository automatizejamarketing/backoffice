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

export type CampaignBudgetMode = "ABO" | "CBO";

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
  action_values?: Array<{
    action_type: string;
    value: string;
  }>;
  purchase_roas?: Array<{
    action_type: string;
    value: string;
  }>;
  website_purchase_roas?: Array<{
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
  purchaseCount?: string;
  purchaseCost?: string;
  purchaseValue?: string;
  purchaseRoas?: string;
  websitePurchaseRoas?: string;
  linkClicks?: string;
  landingPageViews?: string;
  leadCount?: string;
  leadCost?: string;
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
  is_adset_budget_sharing_enabled?: boolean | string;
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
  ads?: {
    data: GraphApiAd[];
    paging?: GraphPaging;
  };
  issues_info?: GraphApiAdIssuesInfo[];
};

/**
 * Severity of an `issues_info` item returned by Meta. `HARD_ERROR` blocks
 * delivery entirely; `SOFT_ERROR` reduces delivery (e.g. drops one placement)
 * but the ad keeps running on the remaining placements.
 */
export type AdIssueErrorType = "HARD_ERROR" | "SOFT_ERROR";

/** Hierarchy level where Meta detected the issue. */
export type AdIssueLevel = "AD" | "AD_SET" | "CAMPAIGN";

/** Graph API issues_info item (snake_case). */
export type GraphApiAdIssuesInfo = {
  error_code?: number;
  error_message?: string;
  error_summary?: string;
  error_type?: AdIssueErrorType;
  level?: AdIssueLevel;
  mid?: string;
};

/** ad_review_feedback object (snake_case). */
export type GraphApiAdReviewFeedback = {
  global?: Record<string, string>;
  placement_specific?: Record<string, Record<string, string>>;
};

/** Single issue/warning attached to an entity. camelCase mirror. */
export type AdIssue = {
  errorCode?: number;
  errorMessage?: string;
  errorSummary?: string;
  errorType?: AdIssueErrorType;
  level?: AdIssueLevel;
  mid?: string;
};

/** Review-feedback (camelCase). */
export type AdReviewFeedback = {
  global?: Record<string, string>;
  placementSpecific?: Record<string, Record<string, string>>;
};

/**
 * Counts of descendant entities with delivery issues. Populated by listing
 * endpoints via Graph API subqueries so a parent entity can signal that
 * something is wrong below without forcing a drill-down request.
 */
export type DescendantIssuesCounts = {
  withIssues: number;
  disapproved: number;
};

export type DescendantIssuesSummary = {
  adSets?: DescendantIssuesCounts;
  ads?: DescendantIssuesCounts;
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
  budgetMode: CampaignBudgetMode;
  usesCampaignBudget: boolean;
  isAdsetBudgetSharingEnabled?: boolean;
  startTime?: string;
  stopTime?: string;
  createdTime?: string;
  updatedTime?: string;
  insights?: InsightsMetrics;
  /** Delivery issues reported by Meta on the campaign itself. */
  issues?: AdIssue[];
  /** Rolled-up counts of descendant ad sets / ads with issues. */
  issuesSummary?: DescendantIssuesSummary;
};

export type CampaignAdSetBudgetInput = {
  adsetId: string;
  adsetName?: string;
  budgetType?: "daily" | "lifetime";
  dailyBudget?: number;
  lifetimeBudget?: number;
  startTime?: string;
  endTime?: string;
};

export type CampaignAdSetBudgetChange = {
  adsetId: string;
  adsetName?: string;
  previousDailyBudget?: string | null;
  newDailyBudget?: string | null;
  previousLifetimeBudget?: string | null;
  newLifetimeBudget?: string | null;
};

export type CampaignAdSetScheduleChange = {
  adsetId: string;
  adsetName?: string;
  previousStartTime?: string | null;
  newStartTime?: string | null;
  previousEndTime?: string | null;
  newEndTime?: string | null;
};

// ================================
// Ad Set Types
// ================================

/**
 * Ad Set targeting configuration from Meta Graph API.
 */
export type AudienceRef = {
  id: string;
  name?: string;
};

export type TargetingEntity = {
  id?: string;
  name?: string;
  key?: string;
  [key: string]: unknown;
};

export type AdSetGeoLocation = TargetingEntity & {
  address_string?: string;
  latitude?: number;
  longitude?: number;
  radius?: number | string;
  distance_unit?: string;
};

export type AdSetGeoLocations = {
  countries?: string[];
  country_groups?: string[];
  cities?: Array<TargetingEntity & { key: string; region?: string }>;
  regions?: Array<TargetingEntity & { key: string }>;
  zips?: TargetingEntity[];
  geo_markets?: TargetingEntity[];
  electoral_districts?: TargetingEntity[];
  custom_locations?: AdSetGeoLocation[];
  /** e.g. home, recent, travel_in — Meta location targeting behavior */
  location_types?: string[];
  [key: string]: unknown;
};

export type AdSetTargeting = {
  age_min?: number;
  age_max?: number;
  geo_locations?: AdSetGeoLocations;
  excluded_geo_locations?: AdSetGeoLocations;
  genders?: number[];
  locales?: number[];
  custom_audiences?: AudienceRef[];
  excluded_custom_audiences?: AudienceRef[];
  interests?: TargetingEntity[];
  behaviors?: TargetingEntity[];
  demographics?: TargetingEntity[];
  flexible_spec?: Array<Record<string, TargetingEntity[] | undefined>>;
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  messenger_positions?: string[];
  audience_network_positions?: string[];
  device_platforms?: string[];
  targeting_automation?: Record<string, unknown>;
  exclusions?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AdSetScheduleBlock = {
  days?: number[];
  start_minute?: number;
  end_minute?: number;
  timezone_type?: string;
};

export type TargetingSentenceLine = {
  content?: string;
  [key: string]: unknown;
};

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
  bid_strategy?: string;
  destination_type?: string;
  promoted_object?: Record<string, unknown>;
  targeting?: AdSetTargeting;
  targetingsentencelines?: {
    data: TargetingSentenceLine[];
  };
  pacing_type?: string[] | string;
  adset_schedule?: AdSetScheduleBlock[];
  campaign?: GraphApiCampaign;
  insights?: {
    data: GraphApiInsights[];
  };
  ads?: {
    data: GraphApiAd[];
    paging?: GraphPaging;
  };
  issues_info?: GraphApiAdIssuesInfo[];
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
  bidStrategy?: string;
  destinationType?: string;
  promotedObject?: Record<string, unknown>;
  targeting?: AdSetTargeting;
  targetingSentenceLines?: TargetingSentenceLine[];
  pacingType?: string[] | string;
  adsetSchedule?: AdSetScheduleBlock[];
  campaign?: Campaign;
  insights?: InsightsMetrics;
  /** Delivery issues reported by Meta on the ad set itself. */
  issues?: AdIssue[];
  /** Rolled-up counts of descendant ads with issues. */
  issuesSummary?: Pick<DescendantIssuesSummary, "ads">;
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
  issues_info?: GraphApiAdIssuesInfo[];
  ad_review_feedback?: GraphApiAdReviewFeedback;
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
  /** Delivery issues reported by Meta. Empty/undefined when none. */
  issues?: AdIssue[];
  /** Policy-review feedback (typically present on DISAPPROVED ads). */
  reviewFeedback?: AdReviewFeedback;
};

export type TimeIncrement = "day" | "week" | "month" | "quarterly";

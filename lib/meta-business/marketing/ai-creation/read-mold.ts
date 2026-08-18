/**
 * Read the elected mold's CONFIGURATION (ADR 0022, decision 4).
 *
 * What we copy: the CAMPAIGN (objective, budget mode, bid, special categories) and the AD SET that
 * hosts the elected ad (targeting, placements, optimization, promoted_object/pixel, dayparting) —
 * plus the IDENTITY (page + Instagram) read off the elected ad's creative.
 *
 * What we never copy: the mold's ads, creatives or media, and its other (unvalidated) ad sets.
 *
 * Three reads, no writes.
 */
import { callMeta, type MetaCtx } from "@/lib/meta-business/insights";
import type { AdSetScheduleInput } from "../creation/create-ad-set";
import type { MoldRef } from "./pick-mold";

const CAMPAIGN_FIELDS =
  "objective,daily_budget,lifetime_budget,bid_strategy,special_ad_categories,buying_type";
const AD_SET_FIELDS =
  "optimization_goal,billing_event,destination_type,promoted_object,targeting," +
  "bid_strategy,bid_amount,daily_budget,lifetime_budget,adset_schedule,is_dynamic_creative";
const AD_FIELDS = "conversion_domain,creative{object_story_spec}";

export type CampaignMold = {
  ref: MoldRef;
  campaign: {
    objective: string;
    /** CBO = the campaign carries the budget; ABO = the ad set does. */
    budgetMode: "CBO" | "ABO";
    dailyBudgetCents?: number;
    lifetimeBudgetCents?: number;
    bidStrategy?: string;
    specialAdCategories?: string[];
    buyingType?: string;
  };
  adSet: {
    optimizationGoal: string;
    billingEvent?: string;
    destinationType?: string;
    promotedObject?: Record<string, unknown>;
    /** Meta's `targeting` object, VERBATIM — the proven audience is copied, not re-derived. */
    targeting: Record<string, unknown>;
    schedule?: AdSetScheduleInput;
    bidStrategy?: string;
    bidAmountCents?: number;
    dailyBudgetCents?: number;
    lifetimeBudgetCents?: number;
    /** Fixed at creation and irreversible — a new ad's creative MUST match it. */
    isDynamicCreative: boolean;
  };
  /** The advertising identity behind the mold's ad. */
  identity: { pageId?: string; instagramUserId?: string };
  /** Where the mold's ad sent people, and with which button — the new ad's starting point. */
  destination: { link?: string; ctaType?: string };
  /**
   * The domain the mold's ad declared conversions on — Meta REQUIRES it on offsite-conversion ads,
   * and this one is already verified in the user's Business Manager. Reused unless the user points
   * the new ad at a different domain.
   */
  conversionDomain?: string;
  /** From promoted_object.pixel_id, when the objective tracks conversions. */
  pixelId?: string;
};

type RawCampaign = {
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  special_ad_categories?: string[];
  buying_type?: string;
};

type RawSchedule = {
  days?: number[];
  start_minute?: number;
  end_minute?: number;
  timezone_type?: string;
};

type RawAdSet = {
  optimization_goal?: string;
  billing_event?: string;
  destination_type?: string;
  promoted_object?: Record<string, unknown>;
  targeting?: Record<string, unknown>;
  bid_strategy?: string;
  bid_amount?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  adset_schedule?: RawSchedule[];
  is_dynamic_creative?: boolean;
};

type RawStorySpec = {
  page_id?: string;
  instagram_user_id?: string;
  /** Legacy name for the same thing. */
  instagram_actor_id?: string;
  link_data?: {
    link?: string;
    call_to_action?: { type?: string };
  };
  video_data?: {
    call_to_action?: { type?: string; value?: { link?: string } };
  };
};

type RawAd = {
  conversion_domain?: string;
  creative?: { object_story_spec?: RawStorySpec };
};

const toCents = (value?: string): number | undefined => {
  if (value == null) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
};

function toSchedule(raw?: RawSchedule[]): AdSetScheduleInput | undefined {
  if (!raw?.length) return undefined;
  return {
    mode: "dayparting",
    blocks: raw.map((block) => ({
      days: block.days ?? [],
      startMinute: block.start_minute ?? 0,
      endMinute: block.end_minute ?? 0,
    })),
    timezoneType: block0TimezoneType(raw),
  };
}

function block0TimezoneType(raw: RawSchedule[]): "USER" | "ADVERTISER" {
  return raw[0]?.timezone_type === "USER" ? "USER" : "ADVERTISER";
}

export async function readMold(ctx: MetaCtx, ref: MoldRef): Promise<CampaignMold> {
  const get = <T>(id: string, fields: string) =>
    callMeta<T>({
      domain: "FACEBOOK",
      method: "GET",
      path: id,
      params: `fields=${fields}`,
      accessToken: ctx.accessToken,
    });

  const [campaign, adSet, ad] = await Promise.all([
    get<RawCampaign>(ref.campaignId, CAMPAIGN_FIELDS),
    get<RawAdSet>(ref.adSetId, AD_SET_FIELDS),
    get<RawAd>(ref.adId, AD_FIELDS),
  ]);

  const campaignDaily = toCents(campaign.daily_budget);
  const campaignLifetime = toCents(campaign.lifetime_budget);
  const budgetMode: "CBO" | "ABO" =
    campaignDaily != null || campaignLifetime != null ? "CBO" : "ABO";

  const story = ad.creative?.object_story_spec ?? {};
  const promotedObject = adSet.promoted_object;

  return {
    ref,
    campaign: {
      objective: campaign.objective ?? ref.objective ?? "",
      budgetMode,
      ...(campaignDaily != null ? { dailyBudgetCents: campaignDaily } : {}),
      ...(campaignLifetime != null ? { lifetimeBudgetCents: campaignLifetime } : {}),
      ...(campaign.bid_strategy ? { bidStrategy: campaign.bid_strategy } : {}),
      ...(campaign.special_ad_categories?.length
        ? { specialAdCategories: campaign.special_ad_categories }
        : {}),
      ...(campaign.buying_type ? { buyingType: campaign.buying_type } : {}),
    },
    adSet: {
      optimizationGoal: adSet.optimization_goal ?? "",
      ...(adSet.billing_event ? { billingEvent: adSet.billing_event } : {}),
      ...(adSet.destination_type ? { destinationType: adSet.destination_type } : {}),
      ...(promotedObject ? { promotedObject } : {}),
      targeting: adSet.targeting ?? {},
      ...(toSchedule(adSet.adset_schedule)
        ? { schedule: toSchedule(adSet.adset_schedule) }
        : {}),
      ...(adSet.bid_strategy ? { bidStrategy: adSet.bid_strategy } : {}),
      ...(toCents(adSet.bid_amount) != null
        ? { bidAmountCents: toCents(adSet.bid_amount) }
        : {}),
      ...(toCents(adSet.daily_budget) != null
        ? { dailyBudgetCents: toCents(adSet.daily_budget) }
        : {}),
      ...(toCents(adSet.lifetime_budget) != null
        ? { lifetimeBudgetCents: toCents(adSet.lifetime_budget) }
        : {}),
      isDynamicCreative: Boolean(adSet.is_dynamic_creative),
    },
    identity: {
      ...(story.page_id ? { pageId: story.page_id } : {}),
      ...(story.instagram_user_id || story.instagram_actor_id
        ? { instagramUserId: story.instagram_user_id ?? story.instagram_actor_id }
        : {}),
    },
    destination: {
      ...(story.link_data?.link ? { link: story.link_data.link } : {}),
      ...(story.link_data?.call_to_action?.type
        ? { ctaType: story.link_data.call_to_action.type }
        : story.video_data?.call_to_action?.type
          ? { ctaType: story.video_data.call_to_action.type }
          : {}),
    },
    ...(ad.conversion_domain ? { conversionDomain: ad.conversion_domain } : {}),
    ...(typeof promotedObject?.pixel_id === "string"
      ? { pixelId: promotedObject.pixel_id }
      : {}),
  };
}

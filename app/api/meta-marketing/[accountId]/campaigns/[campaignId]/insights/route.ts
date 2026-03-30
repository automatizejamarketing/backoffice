import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import type {
  DatePreset,
  GraphApiInsights,
  InsightsMetrics,
  TimeIncrement,
} from "@/lib/meta-business/types";

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

type GraphApiInsightsResponse = {
  data: GraphApiInsights[];
};

export type GetCampaignInsightsResponse = Partial<{
  campaignId: string;
  insights?: InsightsMetrics;
  insightsArray?: InsightsMetrics[];
}>;

export type GetCampaignInsightsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

function transformInsights(data: GraphApiInsights): InsightsMetrics {
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; campaignId: string }> }
): Promise<
  NextResponse<GetCampaignInsightsResponse | GetCampaignInsightsErrorResponse>
> {
  try {
    // Verify admin authentication
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Not authenticated",
          message: "You must be logged in to access this resource",
          solution: "Please log in and try again",
        },
        { status: 401 }
      );
    }

    const { campaignId } = await params;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 }
      );
    }

    // Get user's access token from database
    const tokenResult = await getUserAccessTokenByUserId(userId);

    if (!tokenResult.success) {
      return NextResponse.json(
        {
          error: tokenResult.error.error,
          message: tokenResult.error.message,
          solution: tokenResult.error.solution,
        },
        { status: tokenResult.error.statusCode }
      );
    }

    const { accessToken } = tokenResult;

    const datePreset = searchParams.get("datePreset");
    const since = searchParams.get("since");
    const until = searchParams.get("until");
    const timeIncrement = searchParams.get("timeIncrement");

    // Build fields parameter
    const fields = [
      "spend",
      "impressions",
      "clicks",
      "reach",
      "cpc",
      "cpm",
      "ctr",
      "cpp",
      "frequency",
      "actions",
      "cost_per_action_type",
      "action_values",
      "purchase_roas",
      "website_purchase_roas",
      "date_start",
      "date_stop",
    ].join(",");

    // Build query params
    const queryParams: string[] = [`fields=${fields}`];

    // Add date filtering
    if (datePreset) {
      queryParams.push(`date_preset=${datePreset}`);
    } else if (since && until) {
      queryParams.push(`time_range={"since":"${since}","until":"${until}"}`);
    }

    if (timeIncrement) {
      queryParams.push(`time_increment=${timeIncrement}`);
    }

    // Make Graph API request
    const response = await metaApiCall<GraphApiInsightsResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${campaignId}/insights`,
      params: queryParams.join("&"),
      accessToken,
    });

    // Transform response
    if (timeIncrement && response.data && response.data.length > 0) {
      const insightsArray = response.data.map(transformInsights);
      return NextResponse.json(
        {
          campaignId,
          insightsArray,
        },
        { status: 200 }
      );
    }

    const insights = response.data?.[0]
      ? transformInsights(response.data[0])
      : undefined;

    return NextResponse.json(
      {
        campaignId,
        insights,
      },
      { status: 200 }
    );
  } catch (error) {
    console.log("TODELETE - ", error);
    const errorReturn = errorToGraphErrorReturn(error);

    console.error("Error fetching campaign insights:", errorReturn);

    return NextResponse.json(
      {
        error: errorReturn.reason.title,
        message: errorReturn.reason.message,
        solution: errorReturn.reason.solution,
      },
      { status: errorReturn.statusCode }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { transformInsightsData } from "@/lib/meta-business/transformers";
import type {
  GraphApiInsights,
  InsightsMetrics,
} from "@/lib/meta-business/types";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; campaignId: string }> }
): Promise<
  NextResponse<GetCampaignInsightsResponse | GetCampaignInsightsErrorResponse>
> {
  try {
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

    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

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
      "cost_per_result",
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
      const insightsArray = response.data.map(transformInsightsData);
      return NextResponse.json(
        {
          campaignId,
          insightsArray,
        },
        { status: 200 }
      );
    }

    const insights = response.data?.[0]
      ? transformInsightsData(response.data[0])
      : undefined;

    return NextResponse.json(
      {
        campaignId,
        insights,
      },
      { status: 200 }
    );
  } catch (error) {
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

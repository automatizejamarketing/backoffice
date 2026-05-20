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

export type GetAdInsightsResponse = Partial<{
  adId: string;
  insights?: InsightsMetrics;
  insightsArray?: InsightsMetrics[];
}>;

export type GetAdInsightsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adId: string }> }
): Promise<NextResponse<GetAdInsightsResponse | GetAdInsightsErrorResponse>> {
  try {
    const { adId } = await params;
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

    const queryParams: string[] = [`fields=${fields}`];

    if (datePreset) {
      queryParams.push(`date_preset=${datePreset}`);
    } else if (since && until) {
      queryParams.push(`time_range={"since":"${since}","until":"${until}"}`);
    }

    if (timeIncrement) {
      queryParams.push(`time_increment=${timeIncrement}`);
    }

    const response = await metaApiCall<GraphApiInsightsResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${adId}/insights`,
      params: queryParams.join("&"),
      accessToken,
    });

    if (timeIncrement && response.data && response.data.length > 0) {
      const insightsArray = response.data.map(transformInsightsData);
      return NextResponse.json(
        {
          adId,
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
        adId,
        insights,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error fetching ad insights:", errorReturn);

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

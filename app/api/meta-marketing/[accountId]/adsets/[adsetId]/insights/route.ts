import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import type {
  GraphApiInsights,
  InsightsMetrics,
} from "@/lib/meta-business/types";

type GraphApiInsightsResponse = {
  data: GraphApiInsights[];
};

export type GetAdSetInsightsResponse = Partial<{
  adsetId: string;
  insights?: InsightsMetrics;
  insightsArray?: InsightsMetrics[];
}>;

export type GetAdSetInsightsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

function transformInsights(data: GraphApiInsights): InsightsMetrics {
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adsetId: string }> }
): Promise<
  NextResponse<GetAdSetInsightsResponse | GetAdSetInsightsErrorResponse>
> {
  try {
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

    const { adsetId } = await params;
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
      path: `${adsetId}/insights`,
      params: queryParams.join("&"),
      accessToken,
    });

    if (timeIncrement && response.data && response.data.length > 0) {
      const insightsArray = response.data.map(transformInsights);
      return NextResponse.json(
        {
          adsetId,
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
        adsetId,
        insights,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error fetching adset insights:", errorReturn);

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

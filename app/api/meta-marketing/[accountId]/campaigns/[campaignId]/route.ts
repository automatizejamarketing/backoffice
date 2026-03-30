import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import type { Campaign, GraphApiCampaign } from "@/lib/meta-business/types";
import { transformCampaign } from "@/lib/meta-business/transformers";

type GetCampaignResponse = Partial<{
  campaign: Campaign;
}>;

type CampaignErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

function buildCampaignFields(): string {
  return [
    "id",
    "name",
    "status",
    "effective_status",
    "objective",
    "daily_budget",
    "lifetime_budget",
    "budget_remaining",
    "is_adset_budget_sharing_enabled",
    "start_time",
    "stop_time",
    "created_time",
    "updated_time",
  ].join(",");
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ accountId: string; campaignId: string }> },
): Promise<NextResponse<GetCampaignResponse | CampaignErrorResponse>> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Not authenticated",
          message: "You must be logged in to access this resource",
          solution: "Please log in and try again",
        },
        { status: 401 },
      );
    }

    const { campaignId } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's token to use",
        },
        { status: 400 },
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
        { status: tokenResult.error.statusCode },
      );
    }

    const campaign = await metaApiCall<GraphApiCampaign>({
      domain: "FACEBOOK",
      method: "GET",
      path: campaignId,
      params: `fields=${buildCampaignFields()}`,
      accessToken: tokenResult.accessToken,
    });

    return NextResponse.json(
      {
        campaign: transformCampaign(campaign),
      },
      { status: 200 },
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);

    return NextResponse.json(
      {
        error: errorReturn.reason.title,
        message: errorReturn.reason.message,
        solution: errorReturn.reason.solution,
      },
      { status: errorReturn.statusCode },
    );
  }
}

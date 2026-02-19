import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  CampaignStatus,
  type Campaign,
  type DatePreset,
  type EffectiveStatus,
  type GraphApiCampaign,
  type GraphApiInsights,
  type GraphPaging,
  type InsightsMetrics,
  type PaginationInfo,
} from "@/lib/meta-business/types";
import {
  transformCampaign,
  transformInsights,
  transformPaging,
} from "@/lib/meta-business/transformers";

// ================================
// Graph API Response Types
// ================================

type GraphApiCampaignsResponse = {
  data: GraphApiCampaign[];
  paging?: GraphPaging;
};

type GraphApiUpdateCampaignResponse = {
  success: boolean;
};

// ================================
// Route Types
// ================================

export type GetCampaignsQueryParams = {
  limit?: string;
  after?: string;
  before?: string;
  datePreset?: DatePreset;
  since?: string;
  until?: string;
  effectiveStatus?: string;
  userId: string; // Required: identifies which user's token to use
};

export type GetCampaignsResponse = Partial<{
  data: Campaign[];
  pagination: PaginationInfo;
}>;

export type PatchCampaignRequestBody = {
  campaignId: string;
  status: CampaignStatus;
};

export type PatchCampaignResponse = {
  success: boolean;
  campaign?: {
    id: string;
    status: CampaignStatus;
  };
};

export type CampaignsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

// ================================
// Helper Functions
// ================================

/**
 * Build the fields parameter for campaigns query.
 */
function buildCampaignFields(): string {
  const insightsFields =
    "insights{spend,impressions,clicks,reach,cpc,cpm,ctr,cpp,frequency,actions,cost_per_action_type,date_start,date_stop}";

  return [
    "id",
    "name",
    "status",
    "effective_status",
    "objective",
    "daily_budget",
    "lifetime_budget",
    "budget_remaining",
    "start_time",
    "stop_time",
    "created_time",
    "updated_time",
    insightsFields,
  ].join(",");
}

// ================================
// Route Handlers
// ================================

/**
 * GET /api/meta-marketing/[accountId]/campaigns
 *
 * Fetches campaigns from a Meta ad account with inline insights.
 * Requires admin authentication and userId query parameter.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<GetCampaignsResponse | CampaignsErrorResponse>> {
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

    const { accountId } = await params;

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

    const limitParam = searchParams.get("limit");
    const after = searchParams.get("after");
    const before = searchParams.get("before");
    const effectiveStatus = searchParams.get("effectiveStatus");

    // Validate and set limit (default: 25, max: 100)
    let limit = 25;
    if (limitParam) {
      const parsedLimit = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 100);
      }
    }

    // Build fields parameter
    const fields = buildCampaignFields();

    // Build query params
    const queryParams: string[] = [`fields=${fields}`, `limit=${limit}`];

    if (after) {
      queryParams.push(`after=${after}`);
    }
    if (before) {
      queryParams.push(`before=${before}`);
    }

    // Add effective_status filter if provided
    if (effectiveStatus) {
      const statusArray = effectiveStatus.split(",").map((s) => s.trim());
      queryParams.push(
        `effective_status=${encodeURIComponent(JSON.stringify(statusArray))}`
      );
    }

    // Ensure account ID has act_ prefix
    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    // Make Graph API request
    const response = await metaApiCall<GraphApiCampaignsResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${formattedAccountId}/campaigns`,
      params: queryParams.join("&"),
      accessToken,
    });

    // Transform response to camelCase
    const campaigns = response.data.map(transformCampaign);
    const pagination = transformPaging(response.paging);

    return NextResponse.json(
      {
        data: campaigns,
        pagination,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);

    console.error("Error fetching campaigns:", errorReturn);

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

/**
 * PATCH /api/meta-marketing/[accountId]/campaigns
 *
 * Updates a campaign's status (enable/disable).
 * Requires admin authentication and userId query parameter.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<PatchCampaignResponse | CampaignsErrorResponse>> {
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

    const { accountId } = await params;

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

    // Parse request body
    const body: PatchCampaignRequestBody = await request.json();
    const { campaignId, status } = body;

    if (!campaignId || !status) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "campaignId and status are required",
          solution: "Provide both campaignId and status in the request body",
        },
        { status: 400 }
      );
    }

    // Ensure account ID has act_ prefix
    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    // Build update params
    const updateParams = new URLSearchParams({
      status,
    });

    // Make Graph API request to update campaign
    await metaApiCall<GraphApiUpdateCampaignResponse>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${campaignId}`,
      params: updateParams.toString(),
      accessToken,
    });

    return NextResponse.json(
      {
        success: true,
        campaign: {
          id: campaignId,
          status,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);

    console.error("Error updating campaign:", errorReturn);

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

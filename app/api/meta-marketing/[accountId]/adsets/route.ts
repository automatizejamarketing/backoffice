import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  AdSetStatus,
  type AdSet,
  type GraphApiAdSet,
  type GraphPaging,
  type PaginationInfo,
} from "@/lib/meta-business/types";
import { transformAdSet, transformPaging } from "@/lib/meta-business/transformers";

type GraphApiAdSetsResponse = {
  data: GraphApiAdSet[];
  paging?: GraphPaging;
};

type GraphApiUpdateAdSetResponse = {
  success: boolean;
};

export type GetAdSetsResponse = Partial<{
  data: AdSet[];
  pagination: PaginationInfo;
}>;

export type PatchAdSetRequestBody = {
  adsetId: string;
  status: AdSetStatus;
};

export type PatchAdSetResponse = {
  success: boolean;
  adset?: {
    id: string;
    status: AdSetStatus;
  };
};

export type AdSetsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

function buildAdSetFields(): string {
  const insightsFields =
    "insights{spend,impressions,clicks,reach,cpc,cpm,ctr,cpp,frequency,actions,cost_per_action_type,date_start,date_stop}";

  return [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign_id",
    "daily_budget",
    "lifetime_budget",
    "budget_remaining",
    "start_time",
    "end_time",
    "created_time",
    "updated_time",
    "optimization_goal",
    "billing_event",
    "bid_amount",
    insightsFields,
  ].join(",");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<GetAdSetsResponse | AdSetsErrorResponse>> {
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

    const { accountId } = await params;
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

    const limitParam = searchParams.get("limit");
    const after = searchParams.get("after");
    const before = searchParams.get("before");
    const campaignId = searchParams.get("campaignId");
    const effectiveStatus = searchParams.get("effectiveStatus");

    let limit = 25;
    if (limitParam) {
      const parsedLimit = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 100);
      }
    }

    const fields = buildAdSetFields();
    const queryParams: string[] = [`fields=${fields}`, `limit=${limit}`];

    if (after) {
      queryParams.push(`after=${after}`);
    }
    if (before) {
      queryParams.push(`before=${before}`);
    }
    if (campaignId) {
      queryParams.push(`filtering=[{"field":"campaign.id","operator":"EQUAL","value":"${campaignId}"}]`);
    }
    if (effectiveStatus) {
      const statusArray = effectiveStatus.split(",").map((s) => s.trim());
      queryParams.push(
        `effective_status=${encodeURIComponent(JSON.stringify(statusArray))}`
      );
    }

    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    const response = await metaApiCall<GraphApiAdSetsResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${formattedAccountId}/adsets`,
      params: queryParams.join("&"),
      accessToken,
    });

    const adsets = response.data.map(transformAdSet);
    const pagination = transformPaging(response.paging);

    return NextResponse.json(
      {
        data: adsets,
        pagination,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error fetching adsets:", errorReturn);

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<PatchAdSetResponse | AdSetsErrorResponse>> {
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

    const { accountId } = await params;
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
    const body: PatchAdSetRequestBody = await request.json();
    const { adsetId, status } = body;

    if (!adsetId || !status) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "adsetId and status are required",
          solution: "Provide both adsetId and status in the request body",
        },
        { status: 400 }
      );
    }

    const updateParams = new URLSearchParams({ status });

    await metaApiCall<GraphApiUpdateAdSetResponse>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${adsetId}`,
      params: updateParams.toString(),
      accessToken,
    });

    return NextResponse.json(
      {
        success: true,
        adset: {
          id: adsetId,
          status,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error updating adset:", errorReturn);

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

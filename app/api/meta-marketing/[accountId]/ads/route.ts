import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  AdStatus,
  type Ad,
  type GraphApiAd,
  type GraphPaging,
  type PaginationInfo,
} from "@/lib/meta-business/types";
import { transformAd, transformPaging } from "@/lib/meta-business/transformers";

type GraphApiAdsResponse = {
  data: GraphApiAd[];
  paging?: GraphPaging;
};

type GraphApiUpdateAdResponse = {
  success: boolean;
};

export type GetAdsResponse = Partial<{
  data: Ad[];
  pagination: PaginationInfo;
}>;

export type PatchAdRequestBody = {
  adId: string;
  status: AdStatus;
};

export type PatchAdResponse = {
  success: boolean;
  ad?: {
    id: string;
    status: AdStatus;
  };
};

export type AdsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

function buildAdFields(): string {
  const insightsFields =
    "insights{spend,impressions,clicks,reach,cpc,cpm,ctr,cpp,frequency,actions,cost_per_action_type,date_start,date_stop}";

  return [
    "id",
    "name",
    "status",
    "effective_status",
    "adset_id",
    "campaign_id",
    "created_time",
    "updated_time",
    "creative{id,name,title,body,image_url,thumbnail_url,effective_object_story_id}",
    insightsFields,
  ].join(",");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
): Promise<NextResponse<GetAdsResponse | AdsErrorResponse>> {
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
    const adsetId = searchParams.get("adsetId");

    let limit = 25;
    if (limitParam) {
      const parsedLimit = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        limit = Math.min(parsedLimit, 100);
      }
    }

    const fields = buildAdFields();
    const queryParams: string[] = [`fields=${fields}`, `limit=${limit}`];

    if (after) {
      queryParams.push(`after=${after}`);
    }
    if (before) {
      queryParams.push(`before=${before}`);
    }
    if (adsetId) {
      queryParams.push(`filtering=[{"field":"adset.id","operator":"EQUAL","value":"${adsetId}"}]`);
    }

    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    const response = await metaApiCall<GraphApiAdsResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${formattedAccountId}/ads`,
      params: queryParams.join("&"),
      accessToken,
    });

    const ads = response.data.map(transformAd);
    const pagination = transformPaging(response.paging);

    return NextResponse.json(
      {
        data: ads,
        pagination,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error fetching ads:", errorReturn);

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
): Promise<NextResponse<PatchAdResponse | AdsErrorResponse>> {
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
    const body: PatchAdRequestBody = await request.json();
    const { adId, status } = body;

    if (!adId || !status) {
      return NextResponse.json(
        {
          error: "Invalid request",
          message: "adId and status are required",
          solution: "Provide both adId and status in the request body",
        },
        { status: 400 }
      );
    }

    const updateParams = new URLSearchParams({ status });

    await metaApiCall<GraphApiUpdateAdResponse>({
      domain: "FACEBOOK",
      method: "POST",
      path: `${adId}`,
      params: updateParams.toString(),
      accessToken,
    });

    return NextResponse.json(
      {
        success: true,
        ad: {
          id: adId,
          status,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error updating ad:", errorReturn);

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

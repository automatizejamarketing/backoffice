import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getAdAccountPixels } from "@/lib/meta-business/get-ad-account-pixels";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  buildAdSetConversionDetails,
  type AdSetConversionDetails,
} from "@/lib/meta-business/marketing/adset-conversion-details";
import type {
  Ad,
  AdSet,
  GraphApiAdSet,
  PaginationInfo,
} from "@/lib/meta-business/types";
import {
  transformAd,
  transformAdSet,
  transformPaging,
} from "@/lib/meta-business/transformers";

export type GetAdSetResponse = Partial<{
  adset: AdSet;
  ads: Ad[];
  adsPagination: PaginationInfo;
  conversion: AdSetConversionDetails;
}>;

export type GetAdSetErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

function formatAccountId(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

function buildAdSetDetailFields(adsSubquery: string): string {
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
    "bid_strategy",
    "destination_type",
    "promoted_object",
    "is_dynamic_creative",
    "targeting",
    "targetingsentencelines{content}",
    "pacing_type",
    "adset_schedule",
    "campaign{id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,is_adset_budget_sharing_enabled,created_time,updated_time}",
    "insights{spend,impressions,clicks,reach,cpc,cpm,ctr,cpp,frequency,actions,cost_per_action_type,cost_per_result,action_values,purchase_roas,website_purchase_roas,date_start,date_stop}",
    `${adsSubquery}{id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time,creative{id,name,title,body,image_url,thumbnail_url,effective_object_story_id,call_to_action,object_story_spec,asset_feed_spec},insights{spend,impressions,clicks,reach,cpc,cpm,ctr,actions,cost_per_action_type,cost_per_result,date_start,date_stop}}`,
  ].join(",");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adsetId: string }> },
): Promise<NextResponse<GetAdSetResponse | GetAdSetErrorResponse>> {
  try {
    const { accountId, adsetId } = await params;
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
        { status: tokenResult.error.statusCode },
      );
    }

    const adsLimitParam = searchParams.get("adsLimit");
    const adsAfter = searchParams.get("adsAfter");

    let adsLimit = 25;
    if (adsLimitParam) {
      const parsedLimit = Number.parseInt(adsLimitParam, 10);
      if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
        adsLimit = Math.min(parsedLimit, 100);
      }
    }

    let adsSubquery = `ads.limit(${adsLimit})`;
    if (adsAfter) {
      adsSubquery = `ads.limit(${adsLimit}).after(${adsAfter})`;
    }

    const fields = buildAdSetDetailFields(adsSubquery);
    const response = await metaApiCall<GraphApiAdSet>({
      domain: "FACEBOOK",
      method: "GET",
      path: adsetId,
      params: `fields=${fields}`,
      accessToken: tokenResult.accessToken,
    });

    const conversionBase = buildAdSetConversionDetails({ adSet: response });
    let conversion = conversionBase;

    if (conversionBase.pixelId) {
      try {
        const pixelsResponse = await getAdAccountPixels(
          formatAccountId(accountId),
          tokenResult.accessToken,
        );
        const pixelNameById = new Map(
          (pixelsResponse.data ?? [])
            .filter((pixel) => Boolean(pixel.id))
            .map((pixel) => [pixel.id, pixel.name?.trim() || pixel.id] as const),
        );
        conversion = buildAdSetConversionDetails({
          adSet: response,
          pixelNameById,
        });
      } catch (pixelError) {
        console.warn(
          "Failed to resolve pixel name for ad set detail:",
          pixelError,
        );
      }
    }

    return NextResponse.json(
      {
        adset: transformAdSet(response),
        ads: response.ads?.data?.map(transformAd) ?? [],
        adsPagination: transformPaging(response.ads?.paging),
        conversion,
      },
      { status: 200 },
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("Error fetching adset:", errorReturn);

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

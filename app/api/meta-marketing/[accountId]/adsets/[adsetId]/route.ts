import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  buildAdSetConversionDetails,
  type AdSetConversionDetails,
} from "@/lib/meta-business/marketing/adset-conversion-details";
import type {
  Ad,
  AdSet,
  GraphApiAd,
  GraphApiAdSet,
  GraphPaging,
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

const CONVERSION_ADS_CAP = 200;
const CONVERSION_ADS_PAGE_SIZE = 50;
const CONVERSION_CREATIVE_FIELDS =
  "id,call_to_action,object_story_spec,asset_feed_spec";

function buildAdSetDetailFields(
  adsSubquery: string,
  creativeFields: string,
): string {
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
    "insights{spend,impressions,clicks,inline_link_clicks,reach,cpc,cost_per_inline_link_click,cpm,ctr,inline_link_click_ctr,cpp,frequency,actions,cost_per_action_type,cost_per_result,action_values,purchase_roas,website_purchase_roas,date_start,date_stop}",
    `${adsSubquery}{id,name,status,effective_status,adset_id,campaign_id,created_time,updated_time,creative{${creativeFields}},insights{spend,impressions,clicks,inline_link_clicks,reach,cpc,cost_per_inline_link_click,cpm,ctr,inline_link_click_ctr,actions,cost_per_action_type,cost_per_result,date_start,date_stop}}`,
  ].join(",");
}

async function fetchAdsForConversion(
  adsetId: string,
  accessToken: string,
): Promise<{ ads: GraphApiAd[]; truncated: boolean }> {
  const ads: GraphApiAd[] = [];
  let after: string | undefined;
  let truncated = false;

  while (ads.length < CONVERSION_ADS_CAP) {
    try {
      const limit = Math.min(
        CONVERSION_ADS_PAGE_SIZE,
        CONVERSION_ADS_CAP - ads.length,
      );
      const params = new URLSearchParams({
        fields: `id,creative{${CONVERSION_CREATIVE_FIELDS}}`,
        limit: String(limit),
      });
      if (after) {
        params.set("after", after);
      }

      const page = await metaApiCall<{
        data?: GraphApiAd[];
        paging?: GraphPaging;
      }>({
        domain: "FACEBOOK",
        method: "GET",
        path: `${adsetId}/ads`,
        params: params.toString(),
        accessToken,
      });

      const batch = page.data ?? [];
      ads.push(...batch);

      const hasNextPage = Boolean(page.paging?.next);
      const nextCursor = page.paging?.cursors?.after;

      if (ads.length >= CONVERSION_ADS_CAP) {
        if (hasNextPage) {
          truncated = true;
        }
        break;
      }

      if (!hasNextPage || batch.length === 0) {
        break;
      }

      // Meta can return paging.next without a usable after cursor; stop rather
      // than replaying the first page until the cap.
      if (!nextCursor) {
        truncated = true;
        break;
      }

      after = nextCursor;
    } catch (error) {
      if (ads.length > 0) {
        return { ads, truncated: true };
      }
      throw error;
    }
  }

  return { ads, truncated };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adsetId: string }> },
): Promise<NextResponse<GetAdSetResponse | GetAdSetErrorResponse>> {
  try {
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

    const includeConversion = searchParams.get("includeConversion") === "1";
    const adsLimitParam = searchParams.get("adsLimit");
    const adsAfter = searchParams.get("adsAfter");

    let adsLimit = 1;
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

    const fields = buildAdSetDetailFields(adsSubquery, "id");
    const response = await metaApiCall<GraphApiAdSet>({
      domain: "FACEBOOK",
      method: "GET",
      path: adsetId,
      params: `fields=${fields}`,
      accessToken: tokenResult.accessToken,
    });

    let conversion: AdSetConversionDetails | undefined;

    if (includeConversion) {
      const conversionBase = buildAdSetConversionDetails({ adSet: response });

      const pixelPromise = conversionBase.pixelId
        ? metaApiCall<{ id: string; name?: string }>({
            domain: "FACEBOOK",
            method: "GET",
            path: conversionBase.pixelId,
            params: "fields=id,name",
            accessToken: tokenResult.accessToken,
          })
            .then((pixel) => pixel.name?.trim() || pixel.id)
            .catch((pixelError) => {
              console.warn(
                "Failed to resolve pixel name for ad set detail:",
                pixelError,
              );
              return undefined;
            })
        : Promise.resolve(undefined);

      const adsPromise = fetchAdsForConversion(
        adsetId,
        tokenResult.accessToken,
      )
        .then((adsResult) => ({
          ads: adsResult.ads,
          truncated: adsResult.truncated,
        }))
        .catch((adsError) => {
          console.warn(
            "Failed to paginate ads for conversion URLs:",
            adsError,
          );
          return {
            ads: response.ads?.data,
            truncated: true as const,
          };
        });

      const [pixelName, adsResult] = await Promise.all([
        pixelPromise,
        adsPromise,
      ]);

      conversion = buildAdSetConversionDetails({
        adSet: response,
        pixelName,
        adsForDestinationUrls: adsResult.ads,
        destinationUrlsTruncated: adsResult.truncated,
      });
    }

    return NextResponse.json(
      {
        adset: transformAdSet(response),
        ads: response.ads?.data?.map(transformAd) ?? [],
        adsPagination: transformPaging(response.ads?.paging),
        ...(conversion && { conversion }),
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

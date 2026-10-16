import { requireMetaAccount } from "@/lib/backoffice/require-meta-account";
import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { getAdvertisingIdentities } from "@/lib/meta-business/get-instagram-connected-page";

export type InstagramMediaType =
  | "IMAGE"
  | "VIDEO"
  | "CAROUSEL_ALBUM"
  | "REELS";

export type BoostEligibilityInfo = {
  eligible_to_boost: boolean;
  ineligible_reason?: string;
};

export type InstagramBusinessMediaItem = {
  id: string;
  caption?: string;
  media_type: InstagramMediaType;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  boost_eligibility_info?: BoostEligibilityInfo;
};

type GraphApiMediaResponse = {
  data: InstagramBusinessMediaItem[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
};

export type GetInstagramUserMediaResponse = {
  media: InstagramBusinessMediaItem[];
  pagination: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    nextCursor?: string;
    previousCursor?: string;
  };
  instagramAccount: {
    id: string;
    username?: string;
  };
};

export type GetInstagramUserMediaErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
  "like_count",
  "comments_count",
  "boost_eligibility_info",
].join(",");

const MAX_PAGES_TO_FILL_ELIGIBLE_MEDIA = 5;

function isBoostEligibleMedia(media: InstagramBusinessMediaItem): boolean {
  return media.boost_eligibility_info?.eligible_to_boost === true;
}

async function getBoostEligibleInstagramMedia(params: {
  instagramBusinessAccountId: string;
  accessToken: string;
  limit: number;
  after?: string | null;
}) {
  const eligibleMedia: InstagramBusinessMediaItem[] = [];
  let nextCursor = params.after ?? undefined;
  let lastPaging: GraphApiMediaResponse["paging"];

  for (
    let pagesLoaded = 0;
    pagesLoaded < MAX_PAGES_TO_FILL_ELIGIBLE_MEDIA &&
    eligibleMedia.length < params.limit;
    pagesLoaded++
  ) {
    const mediaQueryParams = [
      `fields=${MEDIA_FIELDS}`,
      `limit=${params.limit}`,
    ];
    if (nextCursor) {
      mediaQueryParams.push(`after=${nextCursor}`);
    }

    const mediaResponse = await metaApiCall<GraphApiMediaResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${params.instagramBusinessAccountId}/media`,
      params: mediaQueryParams.join("&"),
      accessToken: params.accessToken,
    });

    eligibleMedia.push(
      ...(mediaResponse.data ?? []).filter(isBoostEligibleMedia).slice(
        0,
        params.limit - eligibleMedia.length,
      ),
    );

    lastPaging = mediaResponse.paging;
    nextCursor = mediaResponse.paging?.cursors?.after;

    if (!mediaResponse.paging?.next) {
      break;
    }
  }

  return {
    media: eligibleMedia,
    pagination: {
      hasNextPage: !!lastPaging?.next,
      hasPreviousPage: Boolean(params.after),
      nextCursor: lastPaging?.cursors?.after,
      previousCursor: undefined,
    },
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<
  NextResponse<
    GetInstagramUserMediaResponse | GetInstagramUserMediaErrorResponse
  >
> {
  try {
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

    const accountDenial = await requireMetaAccount(tokenResult.accessToken, tokenResult.connection, accountId);
    if (accountDenial) return accountDenial;
    const { accessToken } = tokenResult;

    const after = searchParams.get("after");
    const requestedInstagramAccountId = searchParams.get(
      "instagramBusinessAccountId",
    );
    const limitParam = searchParams.get("limit");
    let limit = 12;
    if (limitParam) {
      const parsed = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 100);
      }
    }

    // The identities the client can advertise with, Ads Manager semantics — the same list the
    // pages route (and the app) shows. `me/accounts` alone hides a page shared through the
    // Business Manager, and the old fallback then served ANOTHER profile's posts in silence.
    const pagesResponse = await getAdvertisingIdentities(accessToken, {
      adAccountId: accountId,
      tokenKind: tokenResult.connection.tokenKind,
      bisuAppScopedId: tokenResult.connection.bisuAppScopedId,
    });

    if (!pagesResponse.length) return NextResponse.json({error:"instagram_account_not_found",message:"Nenhum Instagram publicitário disponível nesta conta."},{status:404});
    const requestedPage = requestedInstagramAccountId ? pagesResponse.find(identity => identity.instagramBusinessAccountId === requestedInstagramAccountId) : pagesResponse.length === 1 ? pagesResponse[0] : undefined;
    if (!requestedPage) return NextResponse.json({error:"instagram_account_not_found",message:"Selecione um Instagram autorizado nesta conta de anúncios."},{status:404});
    const igAccount = {id:requestedPage.instagramBusinessAccountId,username:requestedPage.instagramUsername};

    const mediaResponse = await getBoostEligibleInstagramMedia({
      instagramBusinessAccountId: igAccount.id,
      accessToken,
      limit,
      after,
    });

    return NextResponse.json(
      {
        media: mediaResponse.media,
        pagination: mediaResponse.pagination,
        instagramAccount: {
          id: igAccount.id,
          username: igAccount.username,
        },
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

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";

export type InstagramMediaType =
  | "IMAGE"
  | "VIDEO"
  | "CAROUSEL_ALBUM"
  | "REELS";

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
};

type GraphApiPage = {
  id: string;
  name?: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    name?: string;
  };
};

type GraphApiPagesResponse = {
  data: GraphApiPage[];
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
].join(",");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<
  NextResponse<
    GetInstagramUserMediaResponse | GetInstagramUserMediaErrorResponse
  >
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
        { status: 401 },
      );
    }

    await params;
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

    const { accessToken } = tokenResult;

    const after = searchParams.get("after");
    const limitParam = searchParams.get("limit");
    let limit = 12;
    if (limitParam) {
      const parsed = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        limit = Math.min(parsed, 100);
      }
    }

    // Get Facebook Pages with connected Instagram Business Accounts
    const pagesResponse = await metaApiCall<GraphApiPagesResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: "me/accounts",
      params: "fields=id,name,instagram_business_account{id,username,name}",
      accessToken,
    });

    const pagesWithInstagram = pagesResponse.data.filter(
      (page) => page.instagram_business_account?.id,
    );

    if (pagesWithInstagram.length === 0) {
      return NextResponse.json(
        {
          error: "No Instagram Business Account",
          message:
            "Nenhuma conta de Instagram Business conectada a esta conta Meta",
          solution:
            "Conecte uma conta de Instagram Business a uma Página do Facebook",
        },
        { status: 404 },
      );
    }

    const igAccount = pagesWithInstagram[0].instagram_business_account!;

    // Build media query params
    const mediaQueryParams = [`fields=${MEDIA_FIELDS}`, `limit=${limit}`];
    if (after) {
      mediaQueryParams.push(`after=${after}`);
    }

    const mediaResponse = await metaApiCall<GraphApiMediaResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${igAccount.id}/media`,
      params: mediaQueryParams.join("&"),
      accessToken,
    });

    return NextResponse.json(
      {
        media: mediaResponse.data ?? [],
        pagination: {
          hasNextPage: !!mediaResponse.paging?.next,
          hasPreviousPage: !!mediaResponse.paging?.previous,
          nextCursor: mediaResponse.paging?.cursors?.after,
          previousCursor: mediaResponse.paging?.cursors?.before,
        },
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

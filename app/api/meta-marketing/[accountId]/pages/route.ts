import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  getPagesWithInstagram,
  type PageIdentity,
} from "@/lib/meta-business/marketing/build-ad-from-media";

export type GetPagesResponse = {
  pages: PageIdentity[];
};

export type GetPagesErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

/**
 * GET /api/meta-marketing/[accountId]/pages?userId=...
 *
 * Lists the Facebook Pages (with a connected Instagram account) available to
 * the target user's Meta token, so an admin can choose the ad identity. The
 * pages come from the user's token (not the ad account), so `accountId` is only
 * part of the route shape and is not used here.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<GetPagesResponse | GetPagesErrorResponse>> {
  try {
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

    const pages = await getPagesWithInstagram(tokenResult.accessToken);

    return NextResponse.json({ pages }, { status: 200 });
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    console.error("[GET pages] Error:", errorReturn);
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

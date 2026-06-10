import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import {
  getAdAccountPixels,
  type FacebookAdsPixelsResponse,
} from "@/lib/meta-business/get-ad-account-pixels";

export type GetPixelsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<FacebookAdsPixelsResponse | GetPixelsErrorResponse>> {
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

    const authz = await requireMarketingUserAccessResponse(
      userId,
      "marketing:read",
    );
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

    if (!accountId?.trim()) {
      return NextResponse.json(
        {
          error: "Missing account ID",
          message: "Account ID is required",
          solution: "Provide a valid ad account ID",
        },
        { status: 400 },
      );
    }

    const formattedAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    const pixelsResponse = await getAdAccountPixels(
      formattedAccountId,
      tokenResult.accessToken,
    );

    return NextResponse.json(pixelsResponse, { status: 200 });
  } catch (error) {
    console.error("Error fetching ads pixels:", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
        solution: "Please try again later",
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { metaApiCall } from "@/lib/meta-business/api";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";

type GraphApiCustomAudience = {
  id: string;
  name?: string;
  subtype?: string;
  approximate_count_lower_bound?: number;
  approximate_count_upper_bound?: number;
};

type GraphApiCustomAudiencesResponse = {
  data: GraphApiCustomAudience[];
};

export type AudienceOption = {
  id: string;
  name: string;
  subtype?: string;
  approximateCount?: number;
};

type GetAudiencesResponse = {
  audiences: AudienceOption[];
};

type GetAudiencesErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

const AUDIENCE_FIELDS = [
  "id",
  "name",
  "subtype",
  "approximate_count_lower_bound",
  "approximate_count_upper_bound",
].join(",");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<GetAudiencesResponse | GetAudiencesErrorResponse>> {
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

    const { accountId } = await params;
    const userId = request.nextUrl.searchParams.get("userId");

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

    const actAccountId = accountId.startsWith("act_")
      ? accountId
      : `act_${accountId}`;

    const response = await metaApiCall<GraphApiCustomAudiencesResponse>({
      domain: "FACEBOOK",
      method: "GET",
      path: `${actAccountId}/customaudiences`,
      params: `fields=${AUDIENCE_FIELDS}&limit=200`,
      accessToken,
    });

    const audiences: AudienceOption[] = response.data
      .filter((a) => a.name)
      .map((a) => ({
        id: a.id,
        name: a.name!,
        subtype: a.subtype,
        approximateCount: a.approximate_count_lower_bound,
      }));

    return NextResponse.json({ audiences }, { status: 200 });
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

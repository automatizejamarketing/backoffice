import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  getAdSetEditLogs,
  type AdSetEditLogWithAdmin,
} from "@/lib/db/admin-queries";

export type GetEditHistoryResponse = {
  logs: AdSetEditLogWithAdmin[];
};

type EditHistoryErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adsetId: string }> }
): Promise<NextResponse<GetEditHistoryResponse | EditHistoryErrorResponse>> {
  try {
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json(
        {
          error: "Missing userId",
          message: "userId query parameter is required",
          solution: "Provide userId to identify which user's logs to read",
        },
        { status: 400 }
      );
    }

    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

    const { adsetId } = await params;

    const logs = await getAdSetEditLogs(adsetId, userId);

    return NextResponse.json(
      {
        logs,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching edit history:", error);

    return NextResponse.json(
      {
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred",
        solution: "Please try again later",
      },
      { status: 500 }
    );
  }
}

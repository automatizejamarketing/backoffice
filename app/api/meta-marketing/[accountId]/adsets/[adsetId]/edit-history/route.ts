import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
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
  _request: NextRequest,
  { params }: { params: Promise<{ accountId: string; adsetId: string }> }
): Promise<NextResponse<GetEditHistoryResponse | EditHistoryErrorResponse>> {
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

    const { adsetId } = await params;

    const logs = await getAdSetEditLogs(adsetId);

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

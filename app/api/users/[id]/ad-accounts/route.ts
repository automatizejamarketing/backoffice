import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import type { FacebookAdAccountBasicInfo } from "@/lib/meta-business/get-user-with-ad-accounts";

export type AdAccountsResponse = {
  data: FacebookAdAccountBasicInfo[];
};

export type AdAccountsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

/**
 * GET /api/users/[id]/ad-accounts
 *
 * Fetches ad accounts for a specific user using their stored Meta Business Account token.
 * Requires admin authentication.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<AdAccountsResponse | AdAccountsErrorResponse>> {
  try {
    // Verify admin authentication
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

    const { id: userId } = await params;

    // Get user's Meta Business Account from database
    const metaAccount = await getUserMetaBusinessAccount(userId);

    if (!metaAccount) {
      return NextResponse.json(
        {
          error: "No connected account",
          message: "User does not have a connected Meta Business Account",
          solution: "User needs to connect their Facebook account first",
        },
        { status: 404 }
      );
    }

    // Fetch ad accounts using the user's stored token
    const userWithAdAccounts = await getUserWithAdAccounts(
      metaAccount.accessToken
    );

    const adAccounts = userWithAdAccounts.adaccounts?.data ?? [];

    return NextResponse.json({ data: adAccounts }, { status: 200 });
  } catch (error) {
    console.error("Error fetching ad accounts:", error);

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

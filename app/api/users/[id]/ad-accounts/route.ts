import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import { getUserWithAdAccounts } from "@/lib/meta-business/get-user-with-ad-accounts";
import type { FacebookAdAccountBasicInfo } from "@/lib/meta-business/get-user-with-ad-accounts";
import { GraphApiError, graphErrorToClientError } from "@/lib/meta-business/error";
import {
  buildReconnectInfo,
  type ReconnectInfo,
} from "@/lib/meta-business/reconnect-link";

export type AdAccountsResponse = {
  data: FacebookAdAccountBasicInfo[];
};

export type AdAccountsErrorResponse = {
  error: string;
  message: string;
  solution?: string;
  code?: number;
  errorSubcode?: number;
  needsReconnect?: boolean;
  reconnect?: ReconnectInfo;
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
    const { id: userId } = await params;
    const authz = await requireMarketingUserAccessResponse(userId);
    if (!authz.ok) return authz.response;

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
    if (error instanceof GraphApiError) {
      const er = error.errorReturn;
      const client = graphErrorToClientError(er);
      const code = er.data?.code;
      const errorSubcode = er.data?.errorSubcode;
      // code 190 (incl. subcode 460 session-invalidated / 463 expired) means
      // the stored token is dead and cannot be refreshed — the user must
      // reconnect their Facebook account via the frontend OAuth flow.
      const needsReconnect = code === 190;

      console.error("backoffice.adAccounts.graphError", {
        code,
        errorSubcode,
        needsReconnect,
      });

      return NextResponse.json(
        {
          ...client,
          code,
          errorSubcode,
          needsReconnect,
          ...(needsReconnect ? { reconnect: buildReconnectInfo() } : {}),
        },
        { status: needsReconnect ? 409 : er.statusCode }
      );
    }

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

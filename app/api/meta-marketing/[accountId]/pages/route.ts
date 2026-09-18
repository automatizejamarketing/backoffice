import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { errorToGraphErrorReturn } from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import type { PageIdentity } from "@/lib/meta-business/marketing/build-ad-from-media";
import { getAdvertisingIdentities } from "@/lib/meta-business/get-instagram-connected-page";
import { flagsForGrantedAsset } from "@/lib/backoffice/meta-asset-selection-flags";
import { listEnabledAssetFlags } from "@/lib/backoffice/meta-enabled-assets";

export type PageIdentityWithSelection = PageIdentity & {
  enabled: boolean;
  primary: boolean;
};

export type GetPagesResponse = {
  pages: PageIdentityWithSelection[];
};

export type GetPagesErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

/**
 * GET /api/meta-marketing/[accountId]/pages?userId=...
 *
 * Lists the Facebook Pages (with a connected Instagram account) the target
 * user can advertise with under `accountId`, so an admin can choose the ad
 * identity. Ads Manager semantics, the same list the app shows: the ad
 * account's `promote_pages` and the BISU's `assigned_pages`, merged with the
 * user's own `me/accounts`. A page shared through the Business Manager is
 * only reachable by the first two — `me/accounts` alone hid it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
): Promise<NextResponse<GetPagesResponse | GetPagesErrorResponse>> {
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

    const pages = await getAdvertisingIdentities(tokenResult.accessToken, {
      adAccountId: accountId,
      tokenKind: tokenResult.connection.tokenKind,
      bisuAppScopedId: tokenResult.connection.bisuAppScopedId,
    });
    const enabledRows = await listEnabledAssetFlags(userId);
    const data = pages.map((page) => ({
      ...page,
      ...flagsForGrantedAsset(enabledRows, "identity", page.pageId),
    }));

    return NextResponse.json({ pages: data }, { status: 200 });
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

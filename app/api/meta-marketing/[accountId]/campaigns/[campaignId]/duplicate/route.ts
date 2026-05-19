import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  errorToGraphErrorReturn,
  graphErrorToClientError,
} from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { duplicateCampaign } from "@/lib/meta-business/duplicate";
import { createDuplicationLog } from "@/lib/db/admin-queries";

export type DuplicateCampaignResponse = {
  success: boolean;
  id: string;
  name: string;
  auditLogFailed?: boolean;
};

export type DuplicateErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; campaignId: string }> },
): Promise<NextResponse<DuplicateCampaignResponse | DuplicateErrorResponse>> {
  try {
    const { accountId, campaignId } = await params;
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
      "marketing:write",
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

    console.log("TODELETE - [POST campaign duplicate] start", {
      accountId,
      campaignId,
      userId,
    });

    const result = await duplicateCampaign({
      accountId,
      campaignId,
      accessToken: tokenResult.accessToken,
    });

    console.log("TODELETE - [POST campaign duplicate] duplicateCampaign result", {
      result,
    });

    let auditLogFailed = false;
    try {
      await createDuplicationLog({
        backofficeUserEmail: authz.actor.email,
        targetUserId: userId,
        entity: "campaign",
        sourceId: campaignId,
        sourceName: result.sourceName,
        newId: result.id,
        newName: result.name,
      });
    } catch (dbErr) {
      console.error("[POST campaign duplicate] audit log failed:", dbErr);
      auditLogFailed = true;
    }

    return NextResponse.json(
      { success: true, id: result.id, name: result.name, auditLogFailed },
      { status: 201 },
    );
  } catch (error) {
    console.log("TODELETE - [POST campaign duplicate] raw error caught", {
      message: error instanceof Error ? error.message : String(error),
      raw: error,
    });
    const errorReturn = errorToGraphErrorReturn(error);
    const clientError = graphErrorToClientError(errorReturn);
    console.error("[POST campaign duplicate] Error:", errorReturn);

    return NextResponse.json(
      {
        error: clientError.error,
        message: clientError.message,
        solution: clientError.solution,
      },
      { status: errorReturn.statusCode },
    );
  }
}

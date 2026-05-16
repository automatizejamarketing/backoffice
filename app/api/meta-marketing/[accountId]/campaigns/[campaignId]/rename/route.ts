import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  errorToGraphErrorReturn,
  graphErrorToClientError,
} from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { normalizeName, renameMetaObject } from "@/lib/meta-business/rename";
import { createRenameLog } from "@/lib/db/admin-queries";

export type RenameResponse = {
  success: boolean;
  name: string;
  auditLogFailed?: boolean;
};

export type RenameErrorResponse = {
  error: string;
  message: string;
  solution?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; campaignId: string }> },
): Promise<NextResponse<RenameResponse | RenameErrorResponse>> {
  try {
    const { campaignId } = await params;
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

    const body: { name?: unknown } = await request.json();
    const validation = normalizeName(body.name);
    if (!validation.ok) {
      return NextResponse.json(
        {
          error: validation.error.title,
          message: validation.error.message,
          solution: validation.error.solution,
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

    const { previousName } = await renameMetaObject({
      objectId: campaignId,
      name: validation.name,
      accessToken: tokenResult.accessToken,
    });

    let auditLogFailed = false;
    try {
      await createRenameLog({
        backofficeUserEmail: authz.actor.email,
        targetUserId: userId,
        entity: "campaign",
        objectId: campaignId,
        previousName,
        newName: validation.name,
      });
    } catch (dbErr) {
      console.error("[POST campaign rename] audit log failed:", dbErr);
      auditLogFailed = true;
    }

    return NextResponse.json(
      { success: true, name: validation.name, auditLogFailed },
      { status: 200 },
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    const clientError = graphErrorToClientError(errorReturn);
    console.error("[POST campaign rename] Error:", errorReturn);

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

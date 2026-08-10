import { enterMetaMutationLog, updateMetaMutationContext } from "@/lib/observability/meta-log-context";
import { attachCorrelationId } from "@/lib/observability/with-meta-logging";
import { NextRequest, NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  errorToGraphErrorReturn,
  graphErrorToClientError,
} from "@/lib/meta-business/error";
import { getUserAccessTokenByUserId } from "@/lib/meta-business/get-user-access-token";
import { normalizeName, renameMetaObject } from "@/lib/meta-business/rename";
import { recordRenameAudit } from "@/lib/backoffice/meta-rename-audit";
import { validateChangeNote } from "@/lib/meta-tracking/internal-change-event";

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
  { params }: { params: Promise<{ accountId: string; adsetId: string }> },
): Promise<NextResponse<RenameResponse | RenameErrorResponse>> {
  enterMetaMutationLog({
    app: "backoffice",
    route: "POST /api/meta-marketing/{accountId}/adsets/{adsetId}/rename",
    operationHint: "rename",
    entityHint: "adset",
  });
  try {
    const { accountId, adsetId } = await params;
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

    updateMetaMutationContext({
      actor: {
        kind: "backoffice",
        id: authz.actor.id,
        email: authz.actor.email,
        role: authz.actor.role,
        targetUserId: userId,
      },
      parentIds: { adAccountId: accountId },
    });

    const body: { name?: unknown; note?: unknown } = await request.json();
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

    // Motivo antes da Meta: renomear muda a marca de Campanha Gerenciada e o
    // hash da configuração — nunca é uma alteração sem consequência.
    const renameNote = validateChangeNote(
      "backoffice_admin",
      typeof body.note === "string" ? body.note : null,
    );
    if (!renameNote.ok) {
      return NextResponse.json(
        {
          error: "Missing note",
          message: renameNote.issue.reason,
          solution: renameNote.issue.suggestion,
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
      objectId: adsetId,
      name: validation.name,
      accessToken: tokenResult.accessToken,
    });

    const audit = await recordRenameAudit({
      entity: "adset",
      backofficeUserEmail: authz.actor.email,
      targetUserId: userId,
      accountId: accountId.startsWith("act_") ? accountId : `act_${accountId}`,
      objectId: adsetId,
      previousName,
      newName: validation.name,
      note: renameNote.note ?? "",
      occurredAt: new Date(),
    });

    return NextResponse.json(
      {
        success: true,
        name: validation.name,
        auditLogFailed: audit.auditLogFailed,
      },
      { status: 200 },
    );
  } catch (error) {
    const errorReturn = errorToGraphErrorReturn(error);
    const clientError = graphErrorToClientError(errorReturn);
    console.error("[POST adset rename] Error:", errorReturn);

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

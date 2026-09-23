import type { CreatePixelLogData } from "@/lib/db/admin-queries";
import type { AiCampaignAuth } from "@/lib/meta-business/ai-campaign-auth";
import type { CreatedPixel } from "@/lib/meta-business/marketing/creation/create-pixel";
import type { CreateIssue, CreateResult } from "@/lib/meta-business/marketing/creation/types";

type AuthOutcome = ({ ok: true } & AiCampaignAuth) | { ok: false; response: Response };

/**
 * Everything the handler touches outside itself, injected so it is testable without mocking
 * modules (bun's `mock.module` is global and leaks across test files). Generic over the request
 * type: the route hands a `NextRequest` to `authorizeAiCampaignWrite`, tests a plain `Request`.
 */
export type CreatePixelHandlerDeps<R extends Request> = {
  authorize: (request: R, accountId: string) => Promise<AuthOutcome>;
  onAuthorized?: (auth: AiCampaignAuth) => void;
  createPixel: (
    adAccountId: string,
    accessToken: string,
    name: string,
  ) => Promise<CreateResult<CreatedPixel>>;
  writeAudit: (entry: CreatePixelLogData) => Promise<unknown>;
  onAuditFailure?: (error: unknown) => void;
  tokenInvalidResponse: () => Response;
};

const RECONNECT_CODES = new Set([190, 102]);

/** HTTP status for a failed create; `null` means the client's Meta token is dead. */
export function createPixelFailureStatus(issue: CreateIssue): number | null {
  if (issue.metaCode != null && RECONNECT_CODES.has(issue.metaCode)) return null;
  switch (issue.code) {
    case "PIXEL_INVALID_PARAMETER":
      return 400;
    case "PIXEL_PERMISSION_DENIED":
      return 403;
    case "PIXEL_ALREADY_EXISTS":
      return 409;
    default:
      return 500;
  }
}

/**
 * `POST /api/meta-marketing/{accountId}/pixels?userId=` — the operator creates the pixel on the
 * CLIENT's ad account with the client's own token, behind the same gate as publishing an AI
 * campaign. The audit row is best-effort, like the duplicate route: Meta already created the
 * pixel, so a failed insert must not report the create as failed.
 */
export async function handleCreatePixel<R extends Request>(
  request: R,
  accountIdParam: string,
  deps: CreatePixelHandlerDeps<R>,
): Promise<Response> {
  const auth = await deps.authorize(request, accountIdParam);
  if (!auth.ok) return auth.response;
  deps.onAuthorized?.(auth);

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name : "";

  const result = await deps.createPixel(auth.accountId, auth.accessToken, name);
  if (!result.ok) {
    const issue = result.issues[0];
    const status = createPixelFailureStatus(issue);
    if (status === null) return deps.tokenInvalidResponse();
    return Response.json(
      {
        success: false,
        code: issue.code,
        message: issue.reason,
        solution: issue.suggestion,
        ...(issue.metaCode != null && { metaCode: issue.metaCode }),
      },
      { status },
    );
  }

  let auditLogFailed = false;
  try {
    await deps.writeAudit({
      backofficeUserEmail: auth.actor.email,
      targetUserId: auth.userId,
      adAccountId: auth.accountId,
      pixelId: result.data.id,
      pixelName: result.data.name,
    });
  } catch (error) {
    deps.onAuditFailure?.(error);
    auditLogFailed = true;
  }

  return Response.json(
    { success: true, id: result.data.id, name: result.data.name, auditLogFailed },
    { status: 201 },
  );
}

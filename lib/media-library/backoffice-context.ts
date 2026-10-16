import type { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { buildBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context-core";
import type { MediaLibraryRequestContext } from "@/lib/media-library/handlers";

export { buildBackofficeMediaLibraryContext } from "@/lib/media-library/backoffice-context-core";

export async function resolveBackofficeMediaLibraryContext(
  userId: string,
  permission: "marketing:read" | "marketing:write",
): Promise<{ ok: true; context: MediaLibraryRequestContext } | { ok: false; response: NextResponse }> {
  const authz = await requireMarketingUserAccessResponse(userId, permission);
  if (!authz.ok) return { ok: false, response: authz.response };
  return { ok: true, context: buildBackofficeMediaLibraryContext(authz.actor, userId) };
}

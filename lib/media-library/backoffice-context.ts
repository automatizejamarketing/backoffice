import type { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import {
  canAccessMarketingUser,
  hasBackofficePermission,
  type BackofficeActor,
} from "@/lib/auth/rbac-core";
import type { MediaLibraryRequestContext } from "@/lib/media-library/handlers";

/** Ator do backoffice como autor; `canWrite` decide os botões de adicionar/excluir na tela. */
export function buildBackofficeMediaLibraryContext(
  actor: BackofficeActor,
  userId: string,
): MediaLibraryRequestContext {
  return {
    userId,
    actor: { kind: "backoffice", email: actor.email },
    viewer: {
      canWrite: hasBackofficePermission(actor, "marketing:write") && canAccessMarketingUser(actor, userId),
    },
  };
}

export async function resolveBackofficeMediaLibraryContext(
  userId: string,
  permission: "marketing:read" | "marketing:write",
): Promise<{ ok: true; context: MediaLibraryRequestContext } | { ok: false; response: NextResponse }> {
  const authz = await requireMarketingUserAccessResponse(userId, permission);
  if (!authz.ok) return { ok: false, response: authz.response };
  return { ok: true, context: buildBackofficeMediaLibraryContext(authz.actor, userId) };
}

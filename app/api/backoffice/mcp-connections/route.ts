import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { canDisconnect, MCP_PAGE_PERMISSION } from "@/lib/mcp/connections";
import { isLockTimeout } from "@/lib/mcp-oauth/http";
import { mcpOauthService } from "@/lib/mcp-oauth/store";

/** "Desconectar" on the Claude page: revokes every live grant of that person on that app. */
export async function DELETE(request: Request) {
  const authz = await requireBackofficePermissionResponse(MCP_PAGE_PERMISSION);
  if (!authz.ok) return authz.response;

  const body = (await request.json().catch(() => null)) as { actorEmail?: unknown; clientId?: unknown } | null;
  if (typeof body?.actorEmail !== "string" || typeof body.clientId !== "string" || !body.actorEmail || !body.clientId) {
    return NextResponse.json({ error: "Informe a pessoa e o app." }, { status: 400 });
  }
  // Grants store the actor's normalized (lowercase) e-mail.
  const actorEmail = body.actorEmail.trim().toLowerCase();
  if (!canDisconnect(authz.actor, actorEmail)) {
    return NextResponse.json({ error: "Só quem gerencia a equipe desconecta o app de outra pessoa." }, { status: 403 });
  }

  try {
    const revoked = await mcpOauthService.disconnect({ actorEmail, clientId: body.clientId });
    return NextResponse.json({ revoked });
  } catch (error) {
    if (!isLockTimeout(error)) throw error;
    return NextResponse.json({ error: "O app está renovando o acesso agora. Tente desconectar de novo em alguns segundos." }, { status: 503 });
  }
}

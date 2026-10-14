import { NextResponse, type NextRequest } from "next/server";
import { getCurrentBackofficeActor } from "@/lib/auth/rbac";
import { canManageAgency } from "@/lib/agency/agencies";
import { authorizeUrl } from "@/lib/clickup/api";
import { callbackPath, clickupCredentials, oauthState } from "@/lib/clickup/connect";
import { resolveIssuer } from "@/lib/mcp-oauth/http";

/** GET ?agencyId= — manda o Dono para autorizar o app da Automatize no ClickUp. */
export async function GET(request: NextRequest) {
  const actor = await getCurrentBackofficeActor();
  const agencyId = request.nextUrl.searchParams.get("agencyId") ?? "";
  if (!actor || !canManageAgency(actor, agencyId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const credentials = clickupCredentials();
  if (!credentials) return NextResponse.json({ error: "O app do ClickUp ainda não foi configurado no Automatize." }, { status: 503 });
  const redirectUri = `${resolveIssuer(request.headers)}${callbackPath}`;
  return NextResponse.redirect(authorizeUrl(credentials.clientId, redirectUri, oauthState(agencyId, actor.id)));
}

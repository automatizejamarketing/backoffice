import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getWorkspaceClients } from "@/lib/consultant-workspace/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("marketing:read");
  if (!authz.ok) return authz.response;
  const days = Number(new URL(request.url).searchParams.get("days") ?? 7) || 7;
  return NextResponse.json(await getWorkspaceClients(authz.actor, { days: Math.min(Math.max(days, 1), 90) }));
}

import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getWorkspaceClientDetail } from "@/lib/consultant-workspace/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const authz = await requireMarketingUserAccessResponse(userId, "marketing:read");
  if (!authz.ok) return authz.response;
  const days = Number(new URL(request.url).searchParams.get("days") ?? 7) || 7;
  const detail = await getWorkspaceClientDetail(authz.actor, userId, Math.min(Math.max(days, 1), 90));
  if (!detail) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
  return NextResponse.json(detail);
}

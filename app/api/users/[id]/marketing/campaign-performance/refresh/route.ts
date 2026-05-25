import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { refreshCampaignPerformanceForUser } from "@/lib/marketing/refresh-campaign-performance";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:read");
  if (!authz.ok) return authz.response;

  const result = await refreshCampaignPerformanceForUser(id);
  return NextResponse.json(result);
}

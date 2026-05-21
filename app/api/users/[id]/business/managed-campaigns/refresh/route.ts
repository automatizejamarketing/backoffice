import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { refreshManagedCampaignCacheForUser } from "@/lib/business/managed-campaigns";
import { getBusinessOperatingRules } from "@/lib/db/business-queries";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await requireMarketingUserAccessResponse(id, "marketing:read");
  if (!authz.ok) return authz.response;

  const rules = await getBusinessOperatingRules();
  const result = await refreshManagedCampaignCacheForUser(id, rules);

  return NextResponse.json(result);
}

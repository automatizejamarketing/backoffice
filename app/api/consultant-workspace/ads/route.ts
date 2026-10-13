import { NextResponse } from "next/server";
import { requireMarketingUserAccessResponse } from "@/lib/auth/rbac";
import { getDossierAds } from "@/lib/consultant-workspace/journey-data";

export const dynamic = "force-dynamic";

/** GET ?userId=…&days=7 → anúncios do período para o dossiê. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const authz = await requireMarketingUserAccessResponse(userId, "marketing:read");
  if (!authz.ok) return authz.response;
  const days = Number(url.searchParams.get("days") ?? 7) || 7;
  return NextResponse.json({ ads: await getDossierAds(userId!, Math.min(Math.max(days, 1), 90)) });
}

import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listReferralAffiliates } from "@/lib/referral/queries";
import { REFERRAL_AFFILIATE_STATUS_VALUES } from "@/lib/db/schema";
import type { ReferralAffiliateStatus } from "@/lib/db/schema";

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const { searchParams } = new URL(request.url);
    const rawStatus = searchParams.get("status");
    const status = REFERRAL_AFFILIATE_STATUS_VALUES.includes(
      rawStatus as ReferralAffiliateStatus,
    )
      ? (rawStatus as ReferralAffiliateStatus)
      : undefined;
    const limit = Math.min(
      Number.parseInt(searchParams.get("limit") || "50", 10),
      100,
    );
    const offset = Number.parseInt(searchParams.get("offset") || "0", 10);

    const affiliates = await listReferralAffiliates(
      { status },
      Number.isFinite(limit) ? limit : 50,
      Number.isFinite(offset) ? offset : 0,
    );

    return NextResponse.json({
      affiliates,
      pagination: { limit, offset, hasMore: affiliates.length === limit },
    });
  } catch (error) {
    console.error("[referral] failed to list affiliates", error);
    return NextResponse.json(
      { error: "Erro ao carregar afiliados" },
      { status: 500 },
    );
  }
}

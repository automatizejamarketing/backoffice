import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  listReferralPayoutRequests,
  summarizeReferralPayoutQueue,
} from "@/lib/referral/payout-queries";
import { REFERRAL_PAYOUT_STATUS_VALUES } from "@/lib/db/schema";
import type { ReferralPayoutStatus } from "@/lib/db/schema";

/** A fila de saques do programa v2, sob a mesma permissão do resto do programa. */
export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const { searchParams } = new URL(request.url);
    const rawStatus = searchParams.get("status");
    const status = REFERRAL_PAYOUT_STATUS_VALUES.includes(
      rawStatus as ReferralPayoutStatus,
    )
      ? (rawStatus as ReferralPayoutStatus)
      : undefined;
    const limit = Math.min(
      Number.parseInt(searchParams.get("limit") || "50", 10),
      100,
    );
    const offset = Number.parseInt(searchParams.get("offset") || "0", 10);

    const [payouts, totals] = await Promise.all([
      listReferralPayoutRequests(
        { status },
        Number.isFinite(limit) ? limit : 50,
        Number.isFinite(offset) ? offset : 0,
      ),
      summarizeReferralPayoutQueue(),
    ]);

    return NextResponse.json({
      payouts,
      totals,
      pagination: { limit, offset, hasMore: payouts.length === limit },
    });
  } catch (error) {
    console.error("[referral] failed to list payout requests", error);
    return NextResponse.json(
      { error: "Erro ao carregar os saques" },
      { status: 500 },
    );
  }
}

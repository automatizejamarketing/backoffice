import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  blockReferralAffiliate,
  ReferralOperationError,
} from "@/lib/referral/queries";

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("affiliates:manage");
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json()) as {
      affiliateId?: unknown;
      reason?: unknown;
    };
    const affiliateId =
      typeof body.affiliateId === "string" ? body.affiliateId : null;
    if (!affiliateId) {
      return NextResponse.json(
        { error: "Informe o afiliado" },
        { status: 400 },
      );
    }
    const reason =
      typeof body.reason === "string" && body.reason.trim().length > 0
        ? body.reason.trim()
        : null;

    await blockReferralAffiliate({
      affiliateId,
      reason,
      adminEmail: authz.actor.email,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ReferralOperationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[referral] failed to block affiliate", error);
    return NextResponse.json(
      { error: "Erro ao bloquear afiliado" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { listProductPurchaseEvidenceForOperator } from "@/lib/db/product-queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { orderId } = await params;
  return NextResponse.json({
    evidence: await listProductPurchaseEvidenceForOperator({
      orderId,
      operatorEmail: authz.actor.email,
    }),
  });
}

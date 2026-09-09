import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { ProductDisputeDefenceError, submitProductDisputeDefence } from "@/lib/products/dispute-defense-service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ disputeId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  try {
    const { disputeId } = await context.params;
    const result = await submitProductDisputeDefence({ disputeId });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductDisputeDefenceError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível enviar a defesa." }, { status: 500 });
  }
}

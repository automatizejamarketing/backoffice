import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { ProductDisputeDefenceError, reviewProductDisputeDefence } from "@/lib/products/dispute-defense-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ disputeId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { operatorNote?: string };
    const { disputeId } = await context.params;
    const defence = await reviewProductDisputeDefence({ disputeId, operatorEmail: authz.actor.email, operatorNote: body.operatorNote });
    return NextResponse.json({ defence });
  } catch (error) {
    if (error instanceof ProductDisputeDefenceError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível registrar a revisão." }, { status: 500 });
  }
}

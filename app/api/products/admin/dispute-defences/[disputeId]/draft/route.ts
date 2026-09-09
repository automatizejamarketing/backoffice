import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { ProductDisputeDefenceError, updateProductDisputeDefenceDraft } from "@/lib/products/dispute-defense-service";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ disputeId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  try {
    const body = (await request.json()) as { operatorNote?: string };
    const { disputeId } = await context.params;
    const row = await updateProductDisputeDefenceDraft({ disputeId, operatorNote: body.operatorNote });
    return NextResponse.json({ defence: row });
  } catch (error) {
    if (error instanceof ProductDisputeDefenceError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível salvar o rascunho." }, { status: 500 });
  }
}

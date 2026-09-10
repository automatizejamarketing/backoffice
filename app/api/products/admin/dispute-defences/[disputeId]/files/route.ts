import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  addProductDisputeDefenceFile,
  ProductDisputeDefenceError,
} from "@/lib/products/dispute-defense-service";

function errorResponse(error: unknown) {
  if (error instanceof ProductDisputeDefenceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Não foi possível anexar a evidência." }, { status: 500 });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ disputeId: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  try {
    const { disputeId } = await context.params;
    const body = (await request.json()) as {
      source?: "proposed" | "operator";
      grantId?: string;
    };
    const source = body.source === "proposed" ? "proposed" : "operator";
    const grantId = String(body.grantId ?? "").trim();
    if (!grantId) {
      return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
    }
    const file = await addProductDisputeDefenceFile({
      disputeId,
      grantId,
      source,
    });
    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

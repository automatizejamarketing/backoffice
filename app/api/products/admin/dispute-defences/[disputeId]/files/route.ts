import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  addProductDisputeDefenceFile,
  getProductDisputeDefence,
  ProductDisputeDefenceError,
  isAllowedDefenceFileType,
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
    const row = await getProductDisputeDefence(disputeId);
    const body = (await request.json()) as {
      source?: "proposed" | "operator";
      fileName?: string;
      contentType?: string;
      sizeBytes?: number;
      storageKey?: string;
    };
    const source = body.source === "proposed" ? "proposed" : "operator";
    const contentType = String(body.contentType ?? "").trim().toLowerCase();
    const sizeBytes = Number(body.sizeBytes);
    const storageKey = String(body.storageKey ?? "").trim();
    if (!isAllowedDefenceFileType(contentType) || !Number.isInteger(sizeBytes) || !storageKey.startsWith(`r2/products/${row.order.productId}/defence/`)) {
      return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
    }
    const file = await addProductDisputeDefenceFile({
      disputeId,
      source,
      fileName: String(body.fileName ?? "evidencia"),
      contentType,
      sizeBytes,
      storageKey,
    });
    return NextResponse.json({ file }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

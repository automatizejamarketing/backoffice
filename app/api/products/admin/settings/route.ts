import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  getProductFinancialSettings,
  updateProductFinancialSettings,
} from "@/lib/db/product-queries";

export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  return NextResponse.json(await getProductFinancialSettings());
}

export async function PATCH(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  try {
    return NextResponse.json(
      await updateProductFinancialSettings(await request.json()),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Configuração inválida" },
      { status: 422 },
    );
  }
}

import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  createProductAdmin,
  listProductsAdmin,
} from "@/lib/db/product-queries";

export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  return NextResponse.json(await listProductsAdmin());
}

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  try {
    return NextResponse.json(
      await createProductAdmin(await request.json()),
      { status: 201 },
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    return NextResponse.json(
      { error: code === "23505" ? "Slug já utilizado" : (error as Error).message },
      { status: code === "23505" ? 409 : 422 },
    );
  }
}


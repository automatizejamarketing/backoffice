import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  createProductContent,
  listProductContent,
} from "@/lib/db/product-queries";

export async function GET(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "productId_required" }, { status: 422 });
  }
  return NextResponse.json(await listProductContent(productId));
}

export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  try {
    return NextResponse.json(
      await createProductContent(await request.json()),
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}


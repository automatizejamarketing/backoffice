import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  deleteProductContent,
  updateProductContent,
} from "@/lib/db/product-queries";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  try {
    const updated = await updateProductContent(id, await request.json());
    return updated
      ? NextResponse.json(updated)
      : NextResponse.json({ error: "not_found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const { id } = await params;
  const deleted = await deleteProductContent(id);
  return deleted
    ? NextResponse.json(deleted)
    : NextResponse.json({ error: "not_found" }, { status: 404 });
}


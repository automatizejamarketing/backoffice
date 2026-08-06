import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { updateExpert } from "@/lib/db/product-queries";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  try {
    const updated = await updateExpert(id, await request.json());
    return updated
      ? NextResponse.json(updated)
      : NextResponse.json({ error: "Expert não encontrado" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}

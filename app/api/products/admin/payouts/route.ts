import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  listPayoutRequests,
  updatePayoutRequest,
} from "@/lib/db/product-queries";

export async function GET() {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  return NextResponse.json(await listPayoutRequests());
}

export async function PATCH(request: Request) {
  const authz = await requireBackofficePermissionResponse("products:manage");
  if (!authz.ok) return authz.response;
  const body = (await request.json()) as {
    id?: string;
    status?: "approved" | "paid" | "rejected" | "canceled";
    proofUrl?: string;
  };
  if (!body.id || !body.status) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 422 });
  }
  if (!["approved", "paid", "rejected", "canceled"].includes(body.status)) {
    return NextResponse.json({ error: "Status inválido" }, { status: 422 });
  }
  try {
    return NextResponse.json(
      await updatePayoutRequest({
        id: body.id,
        status: body.status,
        proofUrl: body.proofUrl,
        adminEmail: authz.actor.email,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 422 },
    );
  }
}

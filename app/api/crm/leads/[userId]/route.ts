import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { isCrmCommercialStatus } from "@/lib/backoffice/crm";
import { getCrmLead, setCrmLeadStatus } from "@/lib/db/crm-queries";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ userId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const authz = await requireBackofficePermissionResponse("users:manage");
  if (!authz.ok) return authz.response;
  const { userId } = await params;
  const detail = await getCrmLead(userId);
  if (!detail) {
    return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function PATCH(request: Request, { params }: Context) {
  const authz = await requireBackofficePermissionResponse("users:manage");
  if (!authz.ok) return authz.response;
  const { userId } = await params;
  const body = (await request.json().catch(() => null)) as
    | { commercialStatus?: unknown }
    | null;
  if (!isCrmCommercialStatus(body?.commercialStatus)) {
    return NextResponse.json(
      { error: "Status comercial inválido" },
      { status: 400 },
    );
  }
  try {
    const result = await setCrmLeadStatus({
      userId,
      status: body.commercialStatus,
      authorEmail: authz.actor.email,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar" },
      { status: 404 },
    );
  }
}

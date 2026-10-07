import { NextResponse } from "next/server";
import { createOwnerInvitation } from "@/lib/agencies/queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { resolveFrontendAppUrl } from "@/lib/env/frontend-app-url";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Novo link de convite de Dono; o anterior para o mesmo e-mail é cancelado. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("agencies:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "agency_not_found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { ownerEmail?: unknown } | null;
  const result = await createOwnerInvitation({
    agencyId: id,
    ownerEmail: typeof body?.ownerEmail === "string" ? body.ownerEmail : "",
    actor: authz.actor,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "agency_not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json(
    {
      agencyId: result.agencyId,
      email: result.email,
      expiresAt: result.expiresAt.toISOString(),
      inviteUrl: `${resolveFrontendAppUrl()}/app/agencias/convite/${result.token}`,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

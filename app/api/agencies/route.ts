import { NextResponse } from "next/server";
import { createAgencyWithOwnerInvitation } from "@/lib/agencies/queries";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { resolveFrontendAppUrl } from "@/lib/env/frontend-app-url";

/** Cria a Agência e devolve o link de convite do Dono (só nesta resposta). */
export async function POST(request: Request) {
  const authz = await requireBackofficePermissionResponse("agencies:manage");
  if (!authz.ok) return authz.response;

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    ownerEmail?: unknown;
  } | null;
  const result = await createAgencyWithOwnerInvitation({
    name: typeof body?.name === "string" ? body.name : "",
    ownerEmail: typeof body?.ownerEmail === "string" ? body.ownerEmail : "",
    actor: authz.actor,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

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

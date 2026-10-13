import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { hasBackofficePermission } from "@/lib/auth/rbac-core";
import { listActiveMarketingConsultants, listConsultantsForFilter } from "@/lib/db/backoffice-rbac-queries";

export const dynamic = "force-dynamic";

/** Consultores para o filtro de carteira e, para quem pode, a lista de quem pode ser responsável. */
export async function GET() {
  const authz = await requireBackofficePermissionResponse("marketing:read");
  if (!authz.ok) return authz.response;
  const canAssign = hasBackofficePermission(authz.actor, "users:manage");
  const [filter, assignable] = await Promise.all([
    listConsultantsForFilter(),
    canAssign ? listActiveMarketingConsultants() : Promise.resolve([]),
  ]);
  return NextResponse.json({
    me: { id: authz.actor.id, email: authz.actor.email, role: authz.actor.role },
    canAssign,
    consultants: filter.map((c) => ({ id: c.id, name: c.name ?? c.email, email: c.email })),
    assignable: assignable.map((c) => ({ id: c.id, name: c.name ?? c.email, email: c.email })),
  });
}

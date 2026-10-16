import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { canManageCrmTags, crmTagInput } from "@/lib/backoffice/crm-tags";
import { getCrmTags, saveCrmTag } from "@/lib/db/crm-tag-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const authz = await requireBackofficePermissionResponse("crm:manage");
  if (!authz.ok) return authz.response;
  return NextResponse.json({
    tags: await getCrmTags(),
    canEdit: canManageCrmTags(authz.actor),
  });
}

export async function PUT(request: Request) {
  const authz = await requireBackofficePermissionResponse("crm:manage");
  if (!authz.ok) return authz.response;
  if (!canManageCrmTags(authz.actor))
    return NextResponse.json(
      { error: "Só o gestor comercial ou um admin edita tags." },
      { status: 403 },
    );
  const parsed = crmTagInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Tag inválida." },
      { status: 400 },
    );
  return NextResponse.json({
    tags: await saveCrmTag(parsed.data, authz.actor.email),
    canEdit: true,
  });
}

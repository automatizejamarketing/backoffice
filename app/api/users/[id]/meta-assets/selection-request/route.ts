import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { requestUserMetaAssetSelectionWithAudit } from "@/lib/backoffice/meta-asset-mutations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("users:manage");
    if (!authz.ok) return authz.response;

    const { id: userId } = await params;
    const body = (await request.json().catch(() => ({}))) as { note?: unknown };
    const note = typeof body.note === "string" ? body.note : null;

    const result = await requestUserMetaAssetSelectionWithAudit({
      userId,
      note,
      adminEmail: authz.actor.email,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    revalidatePath(`/users/${userId}`);

    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error requesting Meta asset selection:", error);
    return NextResponse.json(
      { error: "Failed to request Meta asset selection" },
      { status: 500 },
    );
  }
}

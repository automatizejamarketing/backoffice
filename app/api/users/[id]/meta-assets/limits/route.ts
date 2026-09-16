import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { updateUserMetaAssetLimitsWithAudit } from "@/lib/backoffice/meta-asset-mutations";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("users:manage");
    if (!authz.ok) return authz.response;

    const { id: userId } = await params;
    const body = (await request.json()) as {
      adAccountLimit?: unknown;
      identityLimit?: unknown;
    };

    const result = await updateUserMetaAssetLimitsWithAudit({
      userId,
      adAccountLimit: body.adAccountLimit,
      identityLimit: body.identityLimit,
      adminEmail: authz.actor.email,
    });

    if (!result.ok) {
      if (result.error === "User not found") {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    revalidatePath(`/users/${userId}`);

    return NextResponse.json(
      {
        success: true,
        changed: result.changed,
        limits: result.limits,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error updating Meta asset limits:", error);
    return NextResponse.json(
      { error: "Failed to update Meta asset limits" },
      { status: 500 },
    );
  }
}

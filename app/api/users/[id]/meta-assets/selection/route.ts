import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { setUserMetaAssetSelectionWithAudit } from "@/lib/backoffice/meta-asset-mutations";
import { selectionSetErrorCopy } from "@/lib/backoffice/meta-asset-mutation-plan";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("users:manage");
    if (!authz.ok) return authz.response;

    const { id: userId } = await params;
    const body: unknown = await request.json().catch(() => null);

    const result = await setUserMetaAssetSelectionWithAudit({
      userId,
      body,
      adminEmail: authz.actor.email,
    });

    if (!result.ok) {
      if (result.error === "User not found") {
        return NextResponse.json({ error: result.error }, { status: 404 });
      }
      const copy = selectionSetErrorCopy(result.error);
      const status =
        result.error === "invalid_body"
          ? 400
          : result.error === "reconnect_required" ||
              result.error === "never_connected" ||
              result.error === "lists_unavailable"
            ? 409
            : 422;
      return NextResponse.json(
        copy ?? { error: result.error },
        { status },
      );
    }

    revalidatePath(`/users/${userId}`);

    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Error setting Meta asset selection:", error);
    return NextResponse.json(
      { error: "Failed to set Meta asset selection" },
      { status: 500 },
    );
  }
}

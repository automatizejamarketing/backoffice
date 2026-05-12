import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  getAssignedMarketingConsultant,
  setMarketingConsultantAssignment,
} from "@/lib/db/backoffice-rbac-queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("users:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  const assignment = await getAssignedMarketingConsultant(id);
  return NextResponse.json({ assignment });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("users:manage");
  if (!authz.ok) return authz.response;

  const { id } = await params;
  const body = (await request.json()) as { consultantId?: unknown };
  const consultantId =
    typeof body.consultantId === "string" && body.consultantId !== "none"
      ? body.consultantId
      : null;

  try {
    await setMarketingConsultantAssignment({
      userId: id,
      consultantId,
      assignedByEmail: authz.actor.email,
    });
    const assignment = await getAssignedMarketingConsultant(id);
    revalidatePath(`/users/${id}`);
    return NextResponse.json({ assignment });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_consultant") {
      return NextResponse.json(
        { error: "Invalid consultant" },
        { status: 400 },
      );
    }
    console.error("Error assigning marketing consultant:", error);
    return NextResponse.json(
      { error: "Failed to assign consultant" },
      { status: 500 },
    );
  }
}

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import {
  activateUserAccount,
  getOrCreateUserActivationLink,
} from "@/lib/backoffice/user-activation";

function activationErrorResponse(error: string) {
  if (error === "user_not_found") {
    return NextResponse.json({ error }, { status: 404 });
  }
  return NextResponse.json({ error }, { status: 409 });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("users:manage");
    if (!authz.ok) return authz.response;

    const { id: userId } = await params;
    const result = await getOrCreateUserActivationLink({
      userId,
      adminEmail: authz.actor.email,
    });
    if (!result.ok) return activationErrorResponse(result.error);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error creating user activation link:", error);
    return NextResponse.json(
      { error: "failed_to_create_activation_link" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authz = await requireBackofficePermissionResponse("users:manage");
    if (!authz.ok) return authz.response;

    const { id: userId } = await params;
    const result = await activateUserAccount({
      userId,
      adminEmail: authz.actor.email,
    });
    if (!result.ok) return activationErrorResponse(result.error);

    revalidatePath("/users");
    revalidatePath(`/users/${userId}`);
    return NextResponse.json({
      success: true,
      emailVerified: result.emailVerified.toISOString(),
    });
  } catch (error) {
    console.error("Error activating user account:", error);
    return NextResponse.json(
      { error: "failed_to_activate_user" },
      { status: 500 },
    );
  }
}

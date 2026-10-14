import { hiddenClientResponse, isHiddenClient } from "@/lib/auth/hidden-clients";
import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getUserCancellationAttemptDetails } from "@/lib/db/admin-queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("users:read");
  if (!authz.ok) return authz.response;

  const { id: userId } = await params;
  if (isHiddenClient(authz.actor, userId)) return hiddenClientResponse();
  try {
    const attempts = await getUserCancellationAttemptDetails(userId);
    return NextResponse.json({ attempts });
  } catch (error) {
    console.error("[cancellation-attempts] GET failed", error);
    return NextResponse.json(
      { error: "Failed to load cancellation attempts" },
      { status: 500 },
    );
  }
}

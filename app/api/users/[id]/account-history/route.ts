import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getUserAccountHistory } from "@/lib/db/admin-queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await requireBackofficePermissionResponse("users:manage");
  if (!authz.ok) return authz.response;

  const { id: userId } = await params;
  try {
    const items = await getUserAccountHistory(userId);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[account-history] GET failed", error);
    return NextResponse.json(
      { error: "Failed to load account history" },
      { status: 500 },
    );
  }
}

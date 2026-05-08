import { type NextRequest, NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getPostPerformanceStats } from "@/lib/db/admin-queries";

export async function GET(request: NextRequest) {
  const authz = await requireBackofficePermissionResponse("posts:manage");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") ?? undefined;

  try {
    const stats = await getPostPerformanceStats(userId);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching post stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}

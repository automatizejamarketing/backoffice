import { type NextRequest, NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getBackofficeGeneratedPosts } from "@/lib/db/admin-queries";

export async function GET(request: NextRequest) {
  const authz = await requireBackofficePermissionResponse("posts:manage");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const page = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(searchParams.get("limit") ?? "20", 10);

  try {
    const result = await getBackofficeGeneratedPosts({ page, limit });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching backoffice posts:", error);
    return NextResponse.json(
      { error: "Failed to fetch backoffice posts" },
      { status: 500 }
    );
  }
}

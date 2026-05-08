import { type NextRequest, NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getUsersWithPosts } from "@/lib/db/admin-queries";

export async function GET(request: NextRequest) {
  const authz = await requireBackofficePermissionResponse("posts:manage");
  if (!authz.ok) return authz.response;

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email") ?? undefined;
  const page = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const limit = Number.parseInt(searchParams.get("limit") ?? "20", 10);

  try {
    const result = await getUsersWithPosts({ email, page, limit });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching users with posts:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}

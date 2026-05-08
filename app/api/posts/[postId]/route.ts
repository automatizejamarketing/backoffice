import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getGeneratedImageDetails } from "@/lib/db/admin-queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> }
) {
  const authz = await requireBackofficePermissionResponse("posts:manage");
  if (!authz.ok) return authz.response;

  const { postId } = await params;

  try {
    const details = await getGeneratedImageDetails(postId);
    if (!details) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    return NextResponse.json(details);
  } catch (error) {
    console.error("Error fetching post details:", error);
    return NextResponse.json(
      { error: "Failed to fetch post details" },
      { status: 500 }
    );
  }
}

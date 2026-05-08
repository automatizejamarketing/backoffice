import { NextResponse } from "next/server";
import { requireBackofficePermissionResponse } from "@/lib/auth/rbac";
import { getBackofficePostDetails } from "@/lib/db/admin-queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> }
) {
  const authz = await requireBackofficePermissionResponse("posts:manage");
  if (!authz.ok) return authz.response;

  const { postId } = await params;

  try {
    const postDetail = await getBackofficePostDetails(postId);
    if (!postDetail) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    return NextResponse.json(postDetail);
  } catch (error) {
    console.error("Error fetching backoffice post details:", error);
    return NextResponse.json(
      { error: "Failed to fetch backoffice post details" },
      { status: 500 }
    );
  }
}

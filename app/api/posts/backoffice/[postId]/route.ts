import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { getBackofficePostDetails } from "@/lib/db/admin-queries";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
